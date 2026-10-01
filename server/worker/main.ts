// Worker entrypoint: same config as the app, then hands control to the job runtime (server/jobs).
import { pino } from 'pino'
import { dbReachable, fail, loadConfig, startupDiagnostics } from '../config/diagnostics'
import { createDb } from '../db/client'
import { createAi } from '../ai'
import { createWorker, pgListener } from '../jobs'
import { jobHandlers } from './handlers'
import { startWorker } from './start'

async function main() {
  const log = pino({ base: { service: 'worker' } })
  let config
  try {
    config = loadConfig()
  } catch (err) {
    fail(log, err)
  }
  log.level = config.core.LOG_LEVEL
  const handle = createDb(config.core.DATABASE_URL, config.limits.WORKER_CONCURRENCY + 2)
  log.info(startupDiagnostics(config, { reachable: await dbReachable(handle.db) }), 'startup diagnostics')

  let ai
  try {
    ai = createAi(process.env, { db: handle.db, log })
  } catch (err) {
    fail(log, err)
  }
  const handlers = jobHandlers({ db: handle.db, env: config.core, ai, log })
  const worker = startWorker({
    db: handle.db,
    env: config.core,
    config,
    log,
    handlers,
    // The job runtime runs until SIGTERM aborts `signal`, then drains in-flight jobs.
    run: async ({ signal }) => {
      const runtime = createWorker({
        db: handle.db,
        log,
        handlers,
        concurrency: config.limits.WORKER_CONCURRENCY,
        timeoutSeconds: config.limits.LIMIT_JOB_TIMEOUT_SECONDS,
        listen: pgListener(config.core.DATABASE_URL, log),
      })
      await runtime.start()
      await new Promise<void>((done) => signal.addEventListener('abort', () => done(), { once: true }))
      await runtime.stop(30_000)
    },
  })
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down')
    await worker.stop()
    await handle.close()
    process.exit(0)
  }
  process.once('SIGTERM', () => void shutdown('SIGTERM'))
  process.once('SIGINT', () => void shutdown('SIGINT'))
  await worker.done
}

await main()
