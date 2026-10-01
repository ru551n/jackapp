import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterEach, describe, expect, it } from 'vitest'
import { runReadiness } from '../app/build'
import type { Db } from './client'
import { dbReadiness, migrateWithLock, pendingMigrations } from './migrations'
import * as schema from './schema'

let client: PGlite | undefined
afterEach(async () => client?.close())

describe('migrations', () => {
  it('apply on a fresh database and flip readiness', async () => {
    client = new PGlite()
    const db = drizzle(client, { schema }) as unknown as Db
    expect(await pendingMigrations(db)).toBeGreaterThan(0)
    expect((await runReadiness(dbReadiness(db))).ready).toBe(false)

    await migrateWithLock(db, migrate)
    expect(await pendingMigrations(db)).toBe(0)
    expect(await runReadiness(dbReadiness(db))).toMatchObject({ ready: true })
    await migrateWithLock(db, migrate) // idempotent
    await db.insert(schema.learners).values({ profile: { displayName: 'Jack' } as never })
  })

  it('database check fails when the database is unreachable', async () => {
    client = new PGlite()
    const db = drizzle(client, { schema }) as unknown as Db
    await client.close()
    const r = await runReadiness(dbReadiness(db))
    expect(r.checks.find((c) => c.name === 'database')).toMatchObject({ ok: false })
    client = undefined
  })
})
