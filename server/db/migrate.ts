// `npm run db:migrate` / the compose `migrate` service: apply pending migrations, then exit.
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { pino } from 'pino'
import { CoreEnv, parseEnv } from '../config/env'
import type { Db } from './client'
import { migrateWithLock, pendingMigrations } from './migrations'
import * as schema from './schema'
import { syncBundledCurriculum } from '../curriculum/service'

const env = parseEnv(CoreEnv.pick({ DATABASE_URL: true, LOG_LEVEL: true }))
const log = pino({ level: env.LOG_LEVEL, base: { service: 'migrate' } })
const client = new pg.Client({ connectionString: env.DATABASE_URL })
try {
  await client.connect()
  const db = drizzle(client, { schema }) as unknown as Db
  const before = await pendingMigrations(db)
  await migrateWithLock(db, migrate)
  log.info({ applied: before, pending: await pendingMigrations(db) }, 'migrations complete')
  // Reference data shipped with the release (official Skolverket snapshot), idempotent per version.
  await syncBundledCurriculum(db, log)
} catch (err) {
  log.error({ err: { name: (err as Error).name, message: (err as Error).message } }, 'migration failed')
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}
