import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api'
import * as schema from './schema'

// Fails when the schema changed without `npm run db:generate` (a migration must ship with it).
describe('schema vs migrations', () => {
  it('has no ungenerated schema changes', async () => {
    const dir = join(import.meta.dirname, 'migrations', 'meta')
    const latest = readdirSync(dir)
      .filter((f) => f.endsWith('_snapshot.json'))
      .sort()
      .at(-1)!
    const prev = JSON.parse(readFileSync(join(dir, latest), 'utf8'))
    const statements = await generateMigration(prev, generateDrizzleJson(schema, prev.id))
    expect(statements, 'run `npm run db:generate`').toEqual([])
  })
})
