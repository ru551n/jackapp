# JackApp platform architecture

JackApp is a self-hosted, AI-required learning platform covering förskoleklass to gymnasium, deployed with Docker Compose. The original first-grade transport app is the **early-years experience** inside it.

## Topology

```
Caddy (TLS, reverse proxy) ──► app ──► db (PostgreSQL)
                                │        ▲
                                ▼        │
                     LAN / cloud AI ◄── worker
```

| Service   | Role                                                                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app`     | Fastify: serves the built web app, the JSON API (`/api/v1`), `/health`, `/ready`. Submits jobs.                                                                 |
| `worker`  | The same codebase with a different entrypoint. Runs queued jobs: study-material processing (vision/OCR), generation, images, research, asset fetching, cleanup. |
| `db`      | PostgreSQL. All state, including the job queue.                                                                                                                 |
| `migrate` | A one-shot container running migrations before `app`/`worker` start, so the two never race.                                                                     |

There is no message broker. The job queue is a Postgres table using `FOR UPDATE SKIP LOCKED`, with `LISTEN/NOTIFY` wake-ups and progress written to the job row. The UI follows a job through Server-Sent Events, falling back to polling.

## Decisions

| Topic            | Choice                                                                                                                                                      | Why                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Language         | TypeScript everywhere                                                                                                                                       | Contracts in `shared/contracts` (zod) are shared by web, app and worker.                                                                      |
| HTTP             | Fastify 5                                                                                                                                                   | Mature, fast, good plugin model and logging (pino).                                                                                           |
| Database         | PostgreSQL 17                                                                                                                                               | Concurrent app and worker access, transactions, JSONB for content, reliable queue semantics, mature migrations.                               |
| ORM / migrations | Drizzle ORM + drizzle-kit SQL migrations                                                                                                                    | Typed schema in TS, plain SQL migration files, runs on `pg` and on PGlite for tests.                                                          |
| Queue            | Own Postgres queue (`server/jobs`)                                                                                                                          | No fourth service. Retries, backoff, stale-lock recovery and limits in one small module.                                                      |
| Access           | None in the app; the reverse proxy (e.g. Caddy + Authentik forward auth) decides who reaches it                                                             | Household app: no accounts, logins or sessions. A household adult PIN gates adult screens and adult-only API routes (UX guard, not security). |
| AI               | Capability interfaces (`text`, `vision`, `image`, `embedding`, `research`) with adapters (OpenAI, Anthropic, OpenAI-compatible, Anthropic-compatible, mock) | Provider code stays in `server/ai`. Each capability is configured independently via env.                                                      |
| Validation       | zod schemas + programmatic checks (`server/validation`)                                                                                                     | Model output is never trusted. Math is verified by evaluation.                                                                                |
| Curriculum       | Imported from Skolverket's syllabus API into versioned, source-attributed tables                                                                            | AI is never the source of official curriculum.                                                                                                |
| Tests            | Vitest (`web` and `server` projects), PGlite for DB tests, mock AI providers, Playwright e2e                                                                | No paid API or Docker required for the normal suite.                                                                                          |

## Code layout

```
shared/contracts/   zod contracts (orchestrator-owned)
server/
  app/              Fastify builder, context, route registry, static web serving
  config/           env parsing + startup diagnostics
  db/               drizzle client, schema/<domain>.ts, migrations/
  gate/             adult gate (household PIN, signed cookie), guards (requireAdult, requireLearner)
  ai/               capability interfaces, adapters, registry, limits
  jobs/             queue, worker runtime, job API
  worker/           worker entrypoint + job handler registry
  study/            uploads, ingestion pipeline, processed material
  generation/       prompts, structured generation, artifacts
  validation/       schema, answer, math, grounding, language checks
  curriculum/       Skolverket import, mapping, API
  learners/         profiles, preferences, legacy import
  adaptive/         evidence, gaps, remediation, learning paths
  research/         web research, licensed assets, attribution
  images/           image generation + asset storage
src/                web app (React); src/features/* screens
```

## Rules

- **Adult gate:** adult-only routes call `requireAdult`; learner routes load the learner with `requireLearner` (`server/gate/guards.ts`).
- **Secrets:** they live only in env, are read in `server/config` or `server/ai`, and are never logged or serialized to clients. Clients only see `CapabilityStatus`.
- **Model output:** always parsed against a contract, validated, and stored as structured rows. Raw text is never the only copy.
- **Schema:** each domain owns `server/db/schema/<domain>.ts`. Agents never write migrations; the orchestrator generates them with `npm run db:generate` after integration.
- **Heavy work:** anything slow or AI-bound runs as a job.
