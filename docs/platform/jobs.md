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
- Handlers decide retryability with `tools.fail(code, adultMessage, retryable)`. Any other thrown error becomes `internal` and is **not retried**. Its adult message names only the error class. Raw messages and stacks are never stored, because they may contain URLs or keys.
- **Timeout:** after `LIMIT_JOB_TIMEOUT_SECONDS`, `tools.signal` aborts with reason `'timeout'`. The job then fails with code `timeout` and is not retried. If a handler ignores the signal, its work is abandoned but keeps running in the background, so pass `signal` to fetch and AI calls.
- **Stale locks:** every 10 s the worker refreshes `heartbeat_at` on each job it is running. Every 30 s, maintenance looks for `processing` jobs whose heartbeat is more than 60 s old. Those jobs are requeued with error `worker_lost`, or failed if their attempts are used up.
- **Cancel:** the job becomes `cancelled` at once. A running handler sees the abort (`signal.reason === 'cancelled'`) at the worker's next heartbeat. A late `complete` call does nothing.
- **Shutdown:** `worker.stop(graceMs)` stops claiming new jobs and waits up to `graceMs` for running ones. It then aborts the rest with reason `'shutdown'` and requeues them without counting the attempt.
- Children see `learnerMessage` ("Det gick inte att skapa uppgiften just nu."). Adults see `adultMessage`.

## HTTP

| Route                          | Who   | Result                                   |
| ------------------------------ | ----- | ---------------------------------------- |
| `GET /api/v1/jobs/:id`         | any   | `JobStatus` (`error` only when `failed`) |
| `GET /api/v1/jobs/:id/events`  | any   | SSE stream (below)                       |
| `POST /api/v1/jobs/:id/cancel` | adult | `JobStatus`; 404 unknown                 |
| `POST /api/v1/jobs/:id/retry`  | adult | `JobStatus`; 409 unless `failed`         |

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
- `server/jobs/healthcheck.ts` is the Compose healthcheck. It exits 0 when this container's worker (worker ids start with the hostname) has sent a heartbeat within the last 60 s.
- App readiness has two checks. `jobs.queue` is critical: the queue table must be reachable. `jobs.worker` is non-critical: some worker has sent a recent heartbeat.
- **Scheduler:** `DEFAULT_SCHEDULES` enqueues `uploads.cleanup` hourly, but only on a worker that has a handler for it. The job is deduped per interval with `dedupeKey: schedule:<type>:<bucket>`.

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
4. Add the handler to the worker's handler list in `server/worker`.
5. Enqueue the job from a route with `ctx.jobs.enqueue({ type, payload, learnerId, dedupeKey })`, or with `enqueue(db, …)` directly. Then return the job id so the UI can follow its events.
