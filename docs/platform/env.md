# Environment variables (contract)

The host administrator configures everything technical here. Each subsystem parses its own group with `parseEnv` (`server/config/env.ts`) and validates it at startup. Secret values (`*_API_KEY`, `*_SECRET`, `*_PASSWORD`, `DATABASE_URL`) are never logged or sent to clients. `.env.example` documents all of them.

## Application (`server/config/env.ts`)

`NODE_ENV`, `PORT` (3000), `HOST`, `PUBLIC_URL` (required, external origin), `DATABASE_URL` (required), `SESSION_SECRET` (required, ≥32 chars), `DATA_DIR` (/data), `LOG_LEVEL` (info), `TRUST_PROXY` (comma-separated IPs/CIDRs of the reverse proxy; empty = trust none), `WEB_DIST_DIR`, `ENABLE_DEV_AUTH` + `AUTH_DEV_USER` (development only; refused when `NODE_ENV=production`).

## Database (Compose)

`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`. `DATABASE_URL` is built from these in `compose.yaml`.

## Authentication (`server/auth/config.ts`)

`OIDC_ISSUER_URL` (Authentik application issuer/discovery URL), `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_SCOPES` ("openid profile email"), `SESSION_TTL_HOURS` (720). The redirect URI is always `${PUBLIC_URL}/auth/callback`.

## AI capabilities (`server/ai/config.ts`)

For each `<CAP>` in `TEXT`, `VISION`, `IMAGE`, `EMBEDDING`, `RESEARCH`:

| Variable              | Meaning                                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AI_<CAP>_PROVIDER`   | `openai`, `anthropic`, `openai-compatible`, `anthropic-compatible`, `mock` (dev/test). For `RESEARCH`: `searxng`, `brave`, `tavily`. Unset means the capability is disabled. |
| `AI_<CAP>_BASE_URL`   | Endpoint base, e.g. `http://192.168.1.50:8080/v1`. Optional for `openai`/`anthropic`.                                                                                        |
| `AI_<CAP>_API_KEY`    | Secret. Optional for local endpoints.                                                                                                                                        |
| `AI_<CAP>_MODEL`      | Model id. Required except for `RESEARCH`.                                                                                                                                    |
| `AI_<CAP>_TIMEOUT_MS` | Request timeout (120000; images 300000).                                                                                                                                     |
| `AI_<CAP>_STRUCTURED` | TEXT/VISION only: `auto` (default), `json_schema`, `json_mode`, `prompt`.                                                                                                    |

`TEXT` is required for readiness. The others are optional features that report themselves unavailable.

## Features (`server/config/features.ts`)

`FEATURE_WEB_RESEARCH` (true), `FEATURE_EXTERNAL_ASSETS` (true), `FEATURE_IMAGE_GENERATION` (true), `ALLOW_CLOUD_AI` (true), `ALLOW_LOCAL_AI` (true).

A feature is active only when it is enabled and its capability/provider is configured. `ALLOW_CLOUD_AI=false` rejects `openai`/`anthropic` providers at startup. `ALLOW_LOCAL_AI=false` rejects `*-compatible` providers.

## Limits (`server/config/limits.ts`)

| Variable                        | Default |
| ------------------------------- | ------- |
| `LIMIT_AI_REQUESTS_PER_HOUR`    | 2000    |
| `LIMIT_AI_CONCURRENCY`          | 4       |
| `LIMIT_QUEUED_JOBS`             | 500     |
| `LIMIT_JOB_TIMEOUT_SECONDS`     | 1200    |
| `LIMIT_UPLOAD_FILE_MB`          | 30      |
| `LIMIT_UPLOAD_TOTAL_MB`         | 300     |
| `LIMIT_UPLOAD_PAGES`            | 80      |
| `LIMIT_IMAGES_PER_DAY`          | 300     |
| `WORKER_CONCURRENCY`            | 2       |
| `UPLOAD_FAILED_RETENTION_HOURS` | 168     |
