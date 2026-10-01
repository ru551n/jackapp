import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createTestDb } from '../db/client'
import { TEST_ENV } from '../test/helpers'
import { buildApp } from './build'

let close: (() => Promise<void>) | undefined
afterEach(async () => close?.())

describe('static web serving', () => {
  it('serves the built web app at / and keeps /api/v1 and probes separate', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jackapp-web-'))
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>JackApp</title>')
    const h = await createTestDb()
    const app = await buildApp({ ctx: { env: TEST_ENV, db: h.db, readiness: [] }, webDistDir: dir })
    close = async () => (await app.close(), await h.close())

    const index = await app.inject('/')
    expect(index.statusCode).toBe(200)
    expect(index.headers['content-type']).toMatch(/text\/html/)
    expect((await app.inject('/api/v1/nope')).statusCode).toBe(404)
    expect((await app.inject('/health')).json()).toEqual({ status: 'ok' })
  })

  it('starts without a built web app', async () => {
    const h = await createTestDb()
    const app = await buildApp({ ctx: { env: TEST_ENV, db: h.db, readiness: [] }, webDistDir: '/nonexistent' })
    close = async () => (await app.close(), await h.close())
    expect((await app.inject('/')).statusCode).toBe(404)
  })
})
