import { sql } from 'drizzle-orm'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { resolve } from 'node:path'
import type { ReadinessCheck } from '../app/context'
import type { Db } from './client'

/** Relative to the working directory (repo root in dev, /app in the image). */
export const MIGRATIONS_DIR = resolve('server/db/migrations')
const LOCK_KEY = 0x6a61636b // "jack"

/**
 * Apply pending migrations under a Postgres advisory lock, so concurrent migrate runs serialize.
 * `db` must be a single session (pg.Client / PGlite), since advisory locks are per session.
 */
export async function migrateWithLock(
  db: Db,
  migrate: (db: never, cfg: { migrationsFolder: string }) => Promise<void>,
  folder = MIGRATIONS_DIR,
) {
  await db.execute(sql`select pg_advisory_lock(${LOCK_KEY})`)
  try {
    await migrate(db as never, { migrationsFolder: folder })
  } finally {
    await db.execute(sql`select pg_advisory_unlock(${LOCK_KEY})`)
  }
}

/** Number of migration files not yet applied (drizzle applies files newer than the last recorded one). */
export async function pendingMigrations(db: Db, folder = MIGRATIONS_DIR): Promise<number> {
  const files = readMigrationFiles({ migrationsFolder: folder })
  let last = 0
  try {
    const q = sql`select max(created_at) as last from drizzle.__drizzle_migrations`
    const r = (await db.execute(q)) as unknown as { rows: { last: string | null }[] }
    last = Number(r.rows[0]?.last ?? 0)
  } catch {
    // Table missing: nothing applied yet.
  }
  return files.filter((f) => f.folderMillis > last).length
}

export function dbReadiness(db: Db, folder = MIGRATIONS_DIR): ReadinessCheck[] {
  return [
    {
      name: 'database',
      critical: true,
      check: async () => (await db.execute(sql`select 1`), { ok: true }),
    },
    {
      name: 'migrations',
      critical: true,
      check: async () => {
        const n = await pendingMigrations(db, folder)
        return n ? { ok: false, detail: `${n} pending` } : { ok: true }
      },
    },
  ]
}
