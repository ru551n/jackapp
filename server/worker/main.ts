// Worker entrypoint: same config as the app, then hands control to the job runtime (server/jobs).
import { pino } from 'pino'
import { dbReachable, fail, loadConfig, startupDiagnostics } from '../config/diagnostics'
import { createDb } from '../db/client'
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

  // Hook: the orchestrator passes the handler registry and `run` from server/jobs here.
  const worker = startWorker({ db: handle.db, env: config.core, config, log, handlers: {} })
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
