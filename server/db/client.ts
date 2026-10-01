import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import pg from 'pg'
import * as schema from './schema'

/** Driver-agnostic database handle (node-postgres in production, PGlite in tests). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

export interface DbHandle {
  db: Db
  close(): Promise<void>
}

/** Log-safe error summary: name + Postgres SQLSTATE (from `.cause` too). Messages may carry SQL params. */
export function safeErr(e: unknown): { name: string; code?: string } {
  const name = e instanceof Error && /^[A-Za-z]{1,40}$/.test(e.name) ? e.name : 'Error'
  for (let c = e as { code?: unknown; cause?: unknown } | undefined, i = 0; c && i < 5; c = c.cause as typeof c, i++)
    if (typeof c.code === 'string' && /^[0-9A-Z]{5}$/.test(c.code)) return { name, code: c.code }
  return { name }
}

type WarnLog = { warn(o: object, msg: string): void }

export function createDb(url: string, max = 10, log: WarnLog = { warn: (o, m) => console.warn(m, o) }): DbHandle {
  const pool = new pg.Pool({ connectionString: url, max })
  // An idle client's connection dropped (e.g. Postgres restarted): log it; the pool reconnects.
  pool.on('error', (e) => log.warn({ err: safeErr(e) }, 'database connection lost'))
  return { db: drizzlePg(pool, { schema }) as unknown as Db, close: () => pool.end() }
}

/** In-process Postgres (PGlite) with the current schema pushed. For tests only. */
export async function createTestDb(): Promise<DbHandle> {
  const [{ PGlite }, { drizzle }, { pushSchema }] = await Promise.all([
    import('@electric-sql/pglite'),
    import('drizzle-orm/pglite'),
    import('drizzle-kit/api'),
  ])
  const client = new PGlite()
  const db = drizzle(client, { schema })
  const push = await pushSchema(schema, db as never)
  await push.apply()
  return { db: db as unknown as Db, close: () => client.close() }
}

export { schema }
