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

export function createDb(url: string, max = 10): DbHandle {
  const pool = new pg.Pool({ connectionString: url, max })
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
