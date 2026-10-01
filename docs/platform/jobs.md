# Background jobs (`server/jobs`)

Slow or AI-bound work runs as a job. The app enqueues the job and the `worker` service runs it. The queue is the Postgres table `jobs`. Workers claim jobs with `FOR UPDATE SKIP LOCKED` and wake up on `NOTIFY jackapp_jobs`, so there is no separate broker.

## States

```
queued ──claim──► processing ──► completed
  ▲                   │ └──────► failed     (non-retryable, attempts used up, timeout)
  └── retry/backoff ──┘
queued/processing ──cancel──► cancelled
failed ──retry (adult)──► queued   (attempts reset to 0)
```

- **Claim:** one atomic `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING`. The claim increments `attempts` and sets `locked_by` and `heartbeat_at`.
- **Dedupe:** `dedupe_key` is unique among active (`queued`/`processing`) jobs. Enqueueing a key that is already active returns the existing job with `deduped: true`.
- **Limit:** `LIMIT_QUEUED_JOBS` caps active jobs. Going over it throws `HttpError(429, 'limit_exceeded')`. This is a soft cap, so concurrent enqueues can go slightly over it.
- **Retention:** finished jobs are deleted 14 days after `finished_at`.

## Retries, timeouts and failures

- A failed attempt is requeued only when its `JobError.retryable` is true and `attempts < maxAttempts` (default 3). The delay is `10 s · 2^(attempt-1)`, capped at 10 min, then multiplied by a jitter factor in [0.5, 1).
- **`retryAfterMs`:** the requeue waits at least this long when the thrown error (or its `cause`) carries one: a provider's `Retry-After`, or the AI hourly limit (time until the next hour bucket). Handlers pass it on with `tools.fail(code, msg, retryable, e.retryAfterMs)` or `new JobFailure(…, retryAfterMs)`.
- Handlers decide retryability with `tools.fail(code, adultMessage, retryable)`. Any other thrown error becomes `internal` and is **not retried**. Its adult message names only the error class. Raw messages and stacks are never stored, because they may contain URLs or keys.
- **Timeout:** after `LIMIT_JOB_TIMEOUT_SECONDS`, `tools.signal` aborts with reason `'timeout'`. The job then fails with code `timeout` and is not retried. If a handler ignores the signal, its work is abandoned but keeps running in the background, so pass `signal` to fetch and AI calls.
- **Per-type timeouts:** a handler may set `timeoutMs(job, db)` and `retryOnTimeout`. `study.process` gets 60 s per page (at least the default, capped at 4 h) and is retried on timeout, since it keeps finished pages.
- **Final writes:** handlers call `await tools.assertActive?.(tx)` inside the transaction of their final write (study set commit, artifact create, `addVersion`, research brief). It locks the job row and throws if the job was cancelled, timed out, deleted or taken over, so such jobs land nothing.
- **Stale locks:** every 10 s the worker refreshes `heartbeat_at` on each job it is running. Every 30 s, maintenance looks for `processing` jobs whose heartbeat is more than 60 s old. Those jobs are requeued with error `worker_lost`, or failed if their attempts are used up.
- **Cancel:** the job becomes `cancelled` at once. A running handler sees the abort (`signal.reason === 'cancelled'`) at the worker's next heartbeat. A late `complete` call does nothing.
- **Shutdown:** `worker.stop(graceMs)` stops claiming new jobs and waits up to `graceMs` for running ones. It then aborts the rest with reason `'shutdown'` and requeues them without counting the attempt.
- Children see `learnerMessage` ("Det gick inte att skapa uppgiften just nu."). Adults see `adultMessage`.

## HTTP

| Route                           | Who   | Result                                   |
| ------------------------------- | ----- | ---------------------------------------- |
| `GET /api/v1/jobs/:id`          | any   | `JobStatus` (`error` only when `failed`) |
| `GET /api/v1/jobs/:id/events`   | any   | SSE stream (below)                       |
| `POST /api/v1/jobs/:id/cancel`  | adult | `JobStatus`; 404 unknown                 |
| `POST /api/v1/jobs/:id/retry`   | adult | `JobStatus`; 409 unless `failed`         |
| `GET /api/v1/learners/:id/jobs` | any   | `CreationJob[]` (below)                  |

### Creation list (`GET /api/v1/learners/:id/jobs`)

Feeds "Pågår och klart" (adult Material page) and "På gång" (learner home), so material being made survives navigation.

- Types: `artifact.generate`, `artifact.regenerateItem`, `study.process`. Every active job plus the last 20, newest first. `?active=1` returns only queued/processing jobs (used for badges).
- Each entry has a derived `title` (the material's title once it exists, otherwise an instructions excerpt, the type label plus topic, or the study set title). The raw payload is never returned.
- Completed artifact jobs carry `artifactId` and the material's current `approval`.
- Adults see every creation job and the `adultMessage`. Learners see only `artifact.generate` jobs they asked for themselves (`createdBy: 'learner'`), and `error.adultMessage` is replaced by the `learnerMessage`. Adult-made material stays out of the learner's list until it is approved and shows up in their library.
- The web clients poll the list every 3 s while something is active (no SSE per row).

### SSE contract

- The response has the headers `content-type: text/event-stream`, `cache-control: no-cache, no-transform` and `x-accel-buffering: no`.
- The first event is the current status: `event: status\ndata: <JobStatus JSON>\n\n`.
- A new `status` event is sent whenever the status changes. The server checks the database once a second.
- A `: ping` comment is sent every 15 s.
- The server closes the stream right after the event for a terminal state (`completed`, `failed` or `cancelled`).
- An unknown id gets a 404 JSON `ApiError` before the stream starts.
- If the stream fails, the client should fall back to polling `GET /api/v1/jobs/:id`.

## Worker, health and readiness

- `createWorker({ db, log, handlers, concurrency, workerId, listen })` runs up to `concurrency` jobs at once. It wakes on NOTIFY when `listen` is given (`pgListener(DATABASE_URL)`, which uses a dedicated connection), and otherwise polls every 5 s.
- The worker heartbeats to `worker_heartbeats` every 10 s.
- **Listener:** `pgListener` reconnects a lost LISTEN connection with exponential backoff (1 s to 30 s); polling keeps jobs moving meanwhile, and each reconnect wakes the worker once to catch up.
- **Compose healthcheck** (`worker-health.js`, `server/worker/health.ts`): the runtime touches `$DATA_DIR/worker-heartbeat-<hostname>` only after a successful DB heartbeat, so the file appears after the first one and goes stale (over 60 s) when the DB is unreachable. `start_period` in `compose.yaml` covers startup plus about 15 s. `server/jobs/healthcheck.ts` is an alternative DB-query check (this container's worker id, heartbeat within 60 s).
- App readiness has two checks. `jobs.queue` is critical: the queue table must be reachable. `jobs.worker` is non-critical: some worker has sent a recent heartbeat.
- **Scheduler:** `DEFAULT_SCHEDULES` enqueues `uploads.cleanup` hourly, but only on a worker that has a handler for it. The job is deduped per interval with `dedupeKey: schedule:<type>:<bucket>`. Besides upload retention ([uploads.md](uploads.md)) it garbage-collects vision-cache rows no page references (after 24 h) and assets no artifact version references (rows and files, after 7 days).

## Adding a job type

1. Add the type to `JobType` in `shared/contracts/jobs.ts` (orchestrator).
2. Optionally register the payload schema in a module that both the app and the worker import: `registerJobPayload('study.process', z.object({ setId: z.string().uuid() }))`. Payloads of unregistered types must be a JSON object.
3. Write the handler in your domain:
   ```ts
   export const studyProcess = defineJobHandler('study.process', async (job, { db, signal, progress, fail }) => {
     await progress(0.1, 'Läser sidorna')
     if (!ok) fail('upload_unreadable', 'Bilden gick inte att läsa.', false)
     return setId // stored as resultId
   })
   ```
4. Add the handler to the worker's handler list in `server/worker`. To react when a job of another domain completes, add an `onCompleted` hook in `ON_COMPLETED` there. It runs after `run` succeeds and before the job is marked completed, so it runs **at least once** (a crash re-runs the job) and must be idempotent. A throw fails the attempt as retryable (`completion_failed`).
5. Enqueue the job from a route with `ctx.jobs.enqueue({ type, payload, learnerId, dedupeKey })`, or with `enqueue(db, …)` directly. Then return the job id so the UI can follow its events.
