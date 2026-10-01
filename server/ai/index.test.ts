import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SystemStatus } from '../../shared/contracts'
import { buildApp } from '../app/build'
import { createTestDb, type DbHandle } from '../db/client'
import { TEST_ENV } from '../test/helpers'
import { AiError, createAi } from './index'
import { retryAfterOf } from '../jobs/runtime'
import { silentLog, startMockServer } from './test-server'

let handle: DbHandle
beforeAll(async () => {
  handle = await createTestDb()
})
afterAll(async () => handle.close())

const ask = { messages: [{ role: 'user' as const, content: 'hej' }] }
const local = (url: string) => ({
  AI_TEXT_PROVIDER: 'openai-compatible',
  AI_TEXT_BASE_URL: `${url}/v1`,
  AI_TEXT_MODEL: 'qwen-secret-model',
})
const check = (ai: ReturnType<typeof createAi>, name: string) => ai.readiness.find((r) => r.name === name)!.check()

describe('readiness', () => {
  it('distinguishes not configured, unreachable, auth failure and reachable', async () => {
    const none = createAi({}, { db: handle.db, log: silentLog })
    expect(none.readiness.find((r) => r.name === 'ai.text')!.critical).toBe(true)
    expect(none.readiness.find((r) => r.name === 'ai.image')!.critical).toBe(false)
    expect(await check(none, 'ai.text')).toEqual({ ok: false, detail: 'not configured' })

    const dead = await startMockServer(() => ({}))
    await dead.close()
    const down = createAi(local(dead.url), { db: handle.db, log: silentLog })
    expect(await check(down, 'ai.text')).toEqual({ ok: false, detail: 'unreachable' })
    expect(down.status()[0]).toMatchObject({ configured: true, reachable: 'no' })

    const s = await startMockServer((r) => (r.headers.authorization ? { status: 401 } : { json: { data: [] } }))
    const up = createAi(local(s.url), { db: handle.db, log: silentLog, probeTtlMs: 60_000 })
    expect(up.status()[0]!.reachable).toBe('unknown')
    expect(await check(up, 'ai.text')).toEqual({ ok: true, detail: 'reachable' })
    expect(await check(up, 'ai.text')).toEqual({ ok: true, detail: 'reachable' })
    expect(s.requests.map((r) => r.path)).toEqual(['/v1/models']) // cached
    expect(up.status()[0]).toMatchObject({ reachable: 'yes', label: 'AI-textgenerering är tillgänglig' })

    const bad = createAi({ ...local(s.url), AI_TEXT_API_KEY: 'wrong' }, { db: handle.db, log: silentLog })
    expect(await check(bad, 'ai.text')).toEqual({ ok: false, detail: 'authentication failed' })
    await s.close()
  })
})

describe('limits', () => {
  it('counts requests per hour across processes sharing the database', async () => {
    const env = { AI_TEXT_PROVIDER: 'mock', LIMIT_AI_REQUESTS_PER_HOUR: '3' }
    const app = createAi(env, { db: handle.db, log: silentLog })
    const worker = createAi(env, { db: handle.db, log: silentLog })
    await app.text!.generate(ask)
    await worker.text!.generate(ask)
    await app.text!.generate(ask)
    const e = await worker.text!.generate(ask).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(AiError)
    expect(e).toMatchObject({ code: 'ai_rate_limited', retryable: true })
    expect((e as Error).message).toMatch(/timmen/)
    // Retry no earlier than the next hour bucket; the job runtime honours it.
    const wait = retryAfterOf(e)
    expect(wait).toBeGreaterThan(0)
    expect(wait).toBeLessThanOrEqual(3_600_000)
  })

  it('caps concurrent provider calls per process', async () => {
    let active = 0
    let peak = 0
    const ai = createAi(
      { AI_TEXT_PROVIDER: 'mock', LIMIT_AI_CONCURRENCY: '2', LIMIT_AI_REQUESTS_PER_HOUR: '1000' },
      {
        db: handle.db,
        log: silentLog,
        mock: {
          text: async () => {
            peak = Math.max(peak, ++active)
            await new Promise((r) => setTimeout(r, 20))
            active--
            return 'ok'
          },
        },
      },
    )
    const results = await Promise.all(Array.from({ length: 6 }, () => ai.text!.generate(ask)))
    expect(results.map((r) => r.output)).toEqual(Array(6).fill('ok'))
    expect(peak).toBe(2)
  })
})

describe('GET /api/v1/system/status', () => {
  it('reports capabilities without URLs, keys or model ids', async () => {
    const s = await startMockServer(() => ({ json: { data: [] } }))
    const ai = createAi(
      {
        ...local(s.url),
        AI_TEXT_API_KEY: 'sk-SECRET-KEY',
        AI_IMAGE_PROVIDER: 'openai',
        AI_IMAGE_API_KEY: 'sk-SECRET-IMG',
        AI_IMAGE_MODEL: 'gpt-image-secret',
        AI_IMAGE_BASE_URL: `${s.url}/v1`,
      },
      { db: handle.db, log: silentLog },
    )
    const app = await buildApp({ ctx: { env: TEST_ENV, db: handle.db, readiness: ai.readiness, ai } })
    const res = await app.inject('/api/v1/system/status')
    await app.close()
    await s.close()
    expect(res.statusCode).toBe(200)
    const body = SystemStatus.parse(res.json())
    expect(body.ready).toBe(true)
    expect(body.features.imageGeneration).toBe(true)
    expect(body.features.webResearch).toBe(false)
    expect(body.limits).toEqual({ maxUploadFileMb: 30, maxUploadTotalMb: 300, maxPagesPerSet: 80 })
    expect(body.capabilities.find((c) => c.capability === 'image')).toMatchObject({
      configured: true,
      reachable: 'yes',
      label: 'AI-bildgenerering är tillgänglig',
    })
    expect(body.capabilities.find((c) => c.capability === 'research')!.label).toBe('Webbsökning är inte aktiverad')
    expect(res.body).not.toMatch(/SECRET|secret|127\.0\.0\.1|http|qwen|openai/)
  })

  it('reads FEATURE_* and LIMIT_* through server/config (one parser for app, worker and status)', async () => {
    vi.stubEnv('FEATURE_IMAGE_GENERATION', 'false')
    vi.stubEnv('LIMIT_UPLOAD_PAGES', '12')
    const ai = createAi({ AI_TEXT_PROVIDER: 'mock', AI_IMAGE_PROVIDER: 'mock' }, { db: handle.db, log: silentLog })
    const app = await buildApp({ ctx: { env: TEST_ENV, db: handle.db, readiness: [], ai } })
    const body = SystemStatus.parse((await app.inject('/api/v1/system/status')).json())
    await app.close()
    vi.unstubAllEnvs()
    expect(body.features.imageGeneration).toBe(false)
    expect(body.limits.maxPagesPerSet).toBe(12)
  })
})
