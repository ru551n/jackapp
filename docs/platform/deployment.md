# Deployment

## Requirements

- Docker Engine with Compose v2.24+ (any x86-64 or arm64 Linux host).
- 2 GB RAM is enough for app + worker + Postgres. Local AI models need their own hardware.
- A reverse proxy that controls access (see [reverse-proxy.md](reverse-proxy.md)). **JackApp has no login.**
- At least one AI text provider (see [ai-providers.md](ai-providers.md)).

## Quick start

```bash
cp .env.example .env
# Edit .env: PUBLIC_URL, APP_SECRET (openssl rand -hex 32), POSTGRES_PASSWORD (openssl rand -hex 24), AI_TEXT_*
docker compose up -d --build --wait
docker compose ps                 # all healthy; migrate "exited (0)"
curl -s http://127.0.0.1:3000/ready
```

Then point the reverse proxy at it.

**Never keep the example secrets.** The app and worker refuse to start while `APP_SECRET` is a placeholder (`change-me…`, `your-…`, `example…`): anyone who knows the example value could forge the adult-gate cookie. `migrate`, `app` and `worker` likewise refuse a `POSTGRES_PASSWORD` of `change-me`. Postgres stores the password only when the `pgdata` volume is first created; to change it later, run `ALTER USER jackapp PASSWORD '…'` in `psql` too.

**Configuring AI in `.env`:** every provider block in `.env.example` is self-contained. Keep exactly one block per capability uncommented, and don't leave an empty `AI_TEXT_BASE_URL=` (or similar) below the block you chose: later lines win, and an empty value disables the setting. `server/config/env-example.test.ts` checks that every block parses.

Faster image build without bundled speech clips: set `JACKAPP_SKIP_SPEECH=1` in `.env`. The full speech step downloads Python packages and two Piper voices (~170 MB), synthesizes ~2,600 clips (a few minutes on a small server) and adds ~210 MB to the image. Without it, the app speaks with the device's own voice. Voices and clips live in BuildKit cache mounts, so a rebuild only synthesizes new or changed phrases; `docker builder prune` (or a fresh build host) empties the cache, and the next build synthesizes all clips again. The `uv` build image is pinned by minor version (`uv:0.9`), not digest; pin `@sha256:…` in the `Dockerfile` if you need bit-for-bit reproducible builds.

## Topology

| Service   | Command                       | Notes                                                                                   |
| --------- | ----------------------------- | --------------------------------------------------------------------------------------- |
| `db`      | `postgres:17`                 | Only on the internal `backend` network. Never published.                                |
| `migrate` | `node dist-server/migrate.js` | One-shot. Applies pending migrations, then exits 0. `app` and `worker` wait for it.     |
| `app`     | `node dist-server/main.js`    | API (`/api/v1`), the built web app, `/health`, `/ready`. Published on `127.0.0.1:3000`. |
| `worker`  | `node dist-server/worker.js`  | Background jobs. Healthcheck: heartbeat file in `/data`.                                |

All four use the same image (`jackapp:local`). `DATABASE_URL` is built from `POSTGRES_*` in `compose.yaml`. Compose sets `HOST=0.0.0.0` inside the containers; the published port stays on loopback.

- **Shutdown:** `docker compose stop`/`down` gives the worker 45 s (`stop_grace_period`) to finish or release running jobs (it drains for up to 30 s), and the app 15 s. Docker's default of 10 s would kill the worker mid-job.
- **Logs:** every service uses the `json-file` driver with rotation (10 MB × 5 files) via the `x-logging` anchor in `compose.yaml`. Change it there (e.g. to `journald`) for the whole stack. The container healthchecks hit `/ready` every 15 s; the app logs those requests like any other, so lower `LOG_LEVEL` to `warn` if they are noise.
- **Volumes:** the image declares no `VOLUME`; `/data` is the named `appdata` volume from `compose.yaml`. Running the image without a mount keeps `/data` in the container's writable layer, which is lost with the container.

## Volumes and backups

| Volume    | Contents                                                       | Back up?                             |
| --------- | -------------------------------------------------------------- | ------------------------------------ |
| `pgdata`  | All state: learners, progress, content, jobs, settings.        | **Yes.** Use `pg_dump` (consistent). |
| `appdata` | `/data`: uploaded material, processed pages, generated images. | **Yes.** Plain file copy.            |

Write backups **outside the repository** (e.g. `/srv/backups/jackapp`): the build context is the repository, and although `.dockerignore` excludes `*.dump`, `*.tgz` and `backups/`, a backup has no business next to the source. The volume names below assume the default project name `jackapp` (`docker volume ls` shows them).

```bash
B=/srv/backups/jackapp; mkdir -p "$B"
# Database (consistent while running):
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > "$B/jackapp-$(date +%F).dump"
# Files (stop the worker first for a consistent copy, or accept in-flight uploads):
docker run --rm -v jackapp_appdata:/data:ro -v "$B":/backup alpine tar czf /backup/appdata-$(date +%F).tgz -C /data .
```

Restore (same or newer JackApp version):

```bash
B=/srv/backups/jackapp; D=2026-10-01
docker compose stop app worker                     # nothing may write while restoring
docker compose exec -T db sh -c 'pg_restore --clean --if-exists -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$B/jackapp-$D.dump"
docker run --rm -v jackapp_appdata:/data -v "$B":/backup alpine \
  sh -c 'find /data -mindepth 1 -delete && tar xzf /backup/appdata-'"$D"'.tgz -C /data && chown -R 1000:1000 /data'
docker compose up -d --wait                        # migrate runs first, then app and worker
```

`pg_restore --clean --if-exists` drops and recreates every object from the dump, so the database ends up exactly as backed up. The `chown` restores ownership for the image's `node` user (uid 1000).

Also keep a copy of `.env` (it holds `APP_SECRET` and the API keys) somewhere safe.

## Upgrades

```bash
git pull
docker compose up -d --build      # rebuilds, re-runs migrate, then restarts app and worker
docker compose logs migrate       # "migrations complete"
```

Take a backup first. Migrations only move forward; to roll back, restore the backup with the old version.

While `migrate` runs, the **old** app and worker keep serving: Compose recreates them only after `migrate` exits 0. That is safe because migrations are additive (new tables, columns and indexes; nothing the old code reads is dropped or renamed in the same release). A release that must remove or rename something does it in two steps: stop using it in release N, drop it in release N+1.

## Admin commands

The runtime image has no `tsx` or dev dependencies; admin tools are bundled into `dist-server/`:

```bash
docker compose exec app node dist-server/gate-reset-pin.js   # forgotten household PIN (gate.md)
```

`server/app/bundle.test.ts` builds the bundle and checks that every entrypoint and every file read at runtime (curriculum data via `import.meta.url`, migrations via the working directory) is present.

## Health and readiness

- `GET /health`: the process is up (liveness).
- `GET /ready`: 200 when all critical checks pass, else 503 with `{ ready, checks: [{ name, ok, detail }] }`. Checks: `database`, `migrations`, plus those added by other modules (AI text provider, job queue).
- At startup, `app` and `worker` log one `startup diagnostics` line: database reachable, configured AI capabilities (provider kind, model), active features and limits. Secrets are never logged.

## Running without Docker

```bash
npm ci
cp .env.example .env              # set DATABASE_URL to a local Postgres 17, DATA_DIR and WEB_DIST_DIR=dist
npm run db:migrate
npm run dev:server                # app with reload (tsx watch); web dev server: npm run dev
npm run dev:worker
# Production-like:
JACKAPP_SKIP_SPEECH=1 npm run build && npm run build:server && npm start   # npm run start:worker in another shell
```

Outside Docker the app listens on `127.0.0.1` by default (`HOST`), so only a reverse proxy on the same machine can reach it. Set `HOST=0.0.0.0` only if the proxy runs on another host, and firewall the port: JackApp has no login.
