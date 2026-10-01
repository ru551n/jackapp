// App entrypoint: validate config, log diagnostics, serve the API + built web app.
import { pino } from 'pino'
import { buildApp } from './app/build'
import type { ReadinessCheck } from './app/context'
import { trustProxyFrom } from './config/env'
import { dbReachable, fail, loadConfig, startupDiagnostics } from './config/diagnostics'
import { createDb } from './db/client'
import { dbReadiness } from './db/migrations'
import { createAi } from './ai'
import { jobsServices } from './jobs'
import { loadArtifactVersion } from './generation/store'

async function main() {
  const boot = pino({ base: { service: 'app' } })
  let cfg
  try {
    cfg = loadConfig()
  } catch (err) {
    fail(boot, err)
  }
  const { core } = cfg
  const handle = createDb(core.DATABASE_URL, 10, boot)
  let ai
  try {
    ai = createAi(process.env, { db: handle.db, log: boot })
  } catch (err) {
    fail(boot, err)
  }
  const jobs = jobsServices({ db: handle.db })
  const readiness: ReadinessCheck[] = [...dbReadiness(handle.db), ...ai.readiness, ...jobs.readiness]
  const app = await buildApp({
    ctx: { env: core, db: handle.db, readiness, ai, jobs, loadArtifactVersion },
    logger: { level: core.LOG_LEVEL, base: { service: 'app' } },
    trustProxy: trustProxyFrom(core.TRUST_PROXY),
    webDistDir: core.WEB_DIST_DIR,
  })
  app.log.info(startupDiagnostics(cfg, { reachable: await dbReachable(handle.db) }), 'startup diagnostics')

  let closing = false
  const shutdown = async (signal: string) => {
    if (closing) return
    closing = true
    app.log.info({ signal }, 'shutting down')
    await app.close()
    await handle.close()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))

  await app.listen({ port: core.PORT, host: core.HOST })
}

await main()
