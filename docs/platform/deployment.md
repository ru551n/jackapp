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
docker compose up -d --build
docker compose ps                 # all healthy; migrate "exited (0)"
curl -s http://127.0.0.1:3000/ready
```

Then point the reverse proxy at it.

Faster image build without bundled speech clips: set `JACKAPP_SKIP_SPEECH=1` in `.env`. The full speech step downloads Python packages and two Piper voices (~170 MB), synthesizes ~2,600 clips (a few minutes on a small server; BuildKit caches the voices between builds) and adds ~210 MB to the image. Without it, the app speaks with the device's own voice.

## Topology

| Service   | Command                       | Notes                                                                                   |
| --------- | ----------------------------- | --------------------------------------------------------------------------------------- |
| `db`      | `postgres:17`                 | Only on the internal `backend` network. Never published.                                |
| `migrate` | `node dist-server/migrate.js` | One-shot. Applies pending migrations, then exits 0. `app` and `worker` wait for it.     |
| `app`     | `node dist-server/main.js`    | API (`/api/v1`), the built web app, `/health`, `/ready`. Published on `127.0.0.1:3000`. |
| `worker`  | `node dist-server/worker.js`  | Background jobs. Healthcheck: heartbeat file in `/data`.                                |

All four use the same image (`jackapp:local`). `DATABASE_URL` is built from `POSTGRES_*` in `compose.yaml`.

## Volumes and backups

| Volume    | Contents                                                       | Back up?                             |
| --------- | -------------------------------------------------------------- | ------------------------------------ |
| `pgdata`  | All state: learners, progress, content, jobs, settings.        | **Yes.** Use `pg_dump` (consistent). |
| `appdata` | `/data`: uploaded material, processed pages, generated images. | **Yes.** Plain file copy.            |

```bash
docker compose exec -T db pg_dump -U jackapp -Fc jackapp > jackapp-$(date +%F).dump
docker run --rm -v jackapp_appdata:/data -v "$PWD":/backup alpine tar czf /backup/appdata-$(date +%F).tgz -C /data .
# Restore: docker compose exec -T db pg_restore -U jackapp -d jackapp --clean < jackapp-DATE.dump
```

Also keep a copy of `.env` (it holds `APP_SECRET` and the API keys) somewhere safe.

## Upgrades

```bash
git pull
docker compose up -d --build      # rebuilds, re-runs migrate, then restarts app and worker
docker compose logs migrate       # "migrations complete"
```

Take a backup first. Migrations only move forward; to roll back, restore the backup with the old version.

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
