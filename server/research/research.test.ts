import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AiError, createAi, type AiServices, type SearchResult } from '../ai'
import { MOCK_PNG } from '../ai/mock'
import { silentLog } from '../ai/test-server'
import { storeAsset } from '../assets/store'
import { createTestDb, type DbHandle } from '../db/client'
import { researchBriefs, researchSources } from '../db/schema'
import { JobFailure, type JobTools } from '../jobs/runtime'
import { asAdult, createTestApp, TEST_ENV } from '../test/helpers'
import type { HandlerDeps } from '../worker/handlers'
import { findLicensedImages } from './assets'
import { copiesSource, researchBrief, ResearchBriefSchema, ResearchError } from './brief'
import { FetchError, type Fetcher } from './fetch'
import { COMMONS_RESPONSE, OPENVERSE_RESPONSE } from './fixtures'
import { researchJobHandlers } from './jobs'
import { htmlToText } from './text'

let handle: DbHandle
let dataDir: string
beforeAll(async () => {
  handle = await createTestDb()
  dataDir = await mkdtemp(join(tmpdir(), 'jackapp-research-'))
})
afterAll(async () => {
  await handle.close()
  await rm(dataDir, { recursive: true, force: true })
})

const ARTICLE =
  'Gripen är ett svenskt stridsflygplan som tillverkas av Saab i Linköping. Planet flög första gången 1988 ' +
  'och används av flera länder. Det är byggt för att kunna landa på vanliga vägar och skötas av en liten grupp mekaniker. '
const page = (title: string, body: string) =>
  `<html><head><title>${title}</title><meta property="og:site_name" content="Flygsajten">` +
  `<style>.x{}</style><script>var secret=1</script></head><body><nav>Meny</nav>` +
  `<article><h1>${title}</h1><p>${body}</p><p>Mer &amp; mer &#229;&#x00E4;.</p></article><footer>©</footer></body></html>`

/** Fake network: url → response (or error). */
function fakeFetcher(routes: Record<string, { type: string; body: string | Buffer } | Error>) {
  const seen: string[] = []
  const fetcher: Fetcher = async (url, o) => {
    seen.push(url)
    const r = routes[url] ?? new FetchError('http_status', 'HTTP 404')
    if (r instanceof Error) throw r
    if (!o.accept.includes(r.type)) throw new FetchError('content_type', r.type)
    return { url, status: 200, contentType: r.type, body: Buffer.from(r.body) }
  }
  return { fetcher, seen }
}

function aiWith(results: SearchResult[], brief: (prompt: string) => unknown): AiServices {
  const base = createAi(
    { AI_TEXT_PROVIDER: 'mock' },
    { db: handle.db, log: silentLog, mock: { text: (req) => brief(req.messages.at(-1)!.content) } },
  )
  return { ...base, research: { search: async () => results } }
}

const results: SearchResult[] = [
  { title: 'Gripen', url: 'https://a.example/gripen', snippet: 'S'.repeat(1000), publisher: 'A' },
  { title: 'Robots', url: 'https://b.example/private/x', snippet: 'b' },
  { title: 'PDF', url: 'https://c.example/doc.pdf', snippet: 'c' },
  { title: 'Kort', url: 'https://e.example/short', snippet: 'e' },
  { title: 'Saab', url: 'https://d.example/saab', snippet: 'Kort utdrag.' },
]
const net = () =>
  fakeFetcher({
    'https://a.example/gripen': { type: 'text/html', body: page('Om Gripen', ARTICLE.repeat(2)) },
    'https://b.example/robots.txt': { type: 'text/plain', body: 'User-agent: *\nDisallow: /private\n' },
    'https://b.example/private/x': { type: 'text/html', body: page('Hemligt', ARTICLE) },
    'https://c.example/doc.pdf': new FetchError('content_type', 'application/pdf'),
    'https://e.example/short': { type: 'text/html', body: page('Kort', 'För lite.') },
    'https://d.example/saab': { type: 'text/html', body: page('Saab', ARTICLE.split('').reverse().join('')) },
  })

describe('text extraction', () => {
  it('drops scripts/nav, keeps title, site name and decoded text', () => {
    const d = htmlToText(page('T &amp; U', 'Hej'))
    expect(d).toMatchObject({ title: 'T & U', siteName: 'Flygsajten' })
    expect(d.text).toBe('T & U\nHej\nMer & mer åä.')
  })
})

describe('brief schema and copy guard', () => {
  const ok = { summary: 's', keyPoints: [{ text: 't', sources: [1] }] }
  it('is strict and capped', () => {
    expect(ResearchBriefSchema.safeParse(ok).success).toBe(true)
    expect(ResearchBriefSchema.safeParse({ ...ok, quote: 'x' }).success).toBe(false)
    expect(ResearchBriefSchema.safeParse({ ...ok, summary: 'x'.repeat(1501) }).success).toBe(false)
    expect(ResearchBriefSchema.safeParse({ ...ok, keyPoints: [{ text: 'x'.repeat(301), sources: [1] }] }).success).toBe(
      false,
    )
    expect(ResearchBriefSchema.safeParse({ ...ok, keyPoints: [{ text: 't', sources: [] }] }).success).toBe(false)
    expect(ResearchBriefSchema.safeParse({ ...ok, keyPoints: [] }).success).toBe(false)
  })
  it('detects long verbatim runs, not short overlaps', () => {
    expect(copiesSource(`Intro. ${ARTICLE.slice(0, 160)}`, [ARTICLE])).toBe(true)
    expect(copiesSource('Gripen är ett svenskt stridsflygplan. Det kan landa på vägar.', [ARTICLE])).toBe(false)
  })
})

describe('researchBrief', () => {
  it('fetches allowed sources, cites them, stores capped excerpts and drops copied/dangling points', async () => {
    let prompt = ''
    const ai = aiWith(results, (p) => {
      prompt = p
      return {
        summary: 'Gripen är ett svenskt plan från Saab [1].',
        keyPoints: [
          { text: 'Byggt i Linköping.', sources: [1] },
          { text: 'Kan landa på vägar.', sources: [2, 9] },
          { text: ARTICLE.slice(0, 200), sources: [1] },
          { text: 'Bara fel källa.', sources: [7] },
        ],
      }
    })
    const { fetcher, seen } = net()
    const r = await researchBrief(
      handle.db,
      ai,
      { topic: 'Saab Gripen', school: { stage: 'grundskola', year: 4 } },
      { fetcher, env: {} },
    )
    expect(r).not.toBeNull()
    expect(r!.sources.map((s) => s.kind === 'web' && s.url)).toEqual([
      'https://a.example/gripen',
      'https://d.example/saab',
    ])
    expect(r!.sources[0]).toMatchObject({ title: 'Om Gripen', publisher: 'Flygsajten' })
    expect(r!.brief.keyPoints).toEqual([
      { text: 'Byggt i Linköping.', sources: [1] },
      { text: 'Kan landa på vägar.', sources: [2] },
    ])
    expect(seen).not.toContain('https://b.example/private/x')
    expect(prompt).not.toContain('secret')
    expect(prompt).toContain('[2] Saab')

    const rows = await handle.db.select().from(researchSources)
    expect(rows).toHaveLength(2)
    expect(rows.every((s) => s.briefId === r!.briefId && (s.excerpt?.length ?? 0) <= 300)).toBe(true)
    const [b] = await handle.db.select().from(researchBriefs)
    expect(b!.brief).toEqual(r!.brief)
    expect(b!.school).toEqual({ stage: 'grundskola', year: 4 })
  })

  it('rejects a summary that copies a source, and fails with no usable sources', async () => {
    const copying = aiWith(results, () => ({
      summary: ARTICLE.slice(0, 200),
      keyPoints: [{ text: 'ok', sources: [1] }],
    }))
    await expect(
      researchBrief(handle.db, copying, { topic: 'x' }, { fetcher: net().fetcher, env: {} }),
    ).rejects.toThrow(AiError)
    const empty = aiWith([], () => ({}))
    await expect(researchBrief(handle.db, empty, { topic: 'x' }, { fetcher: net().fetcher, env: {} })).rejects.toThrow(
      ResearchError,
    )
  })
})

describe('findLicensedImages', () => {
  const apis = () => {
    const routes: Record<string, { type: string; body: string | Buffer } | Error> = {}
    const pngFor = (u: string) => Buffer.concat([MOCK_PNG, Buffer.from(u)])
    for (const p of Object.values(COMMONS_RESPONSE.query.pages)) {
      const u = p.imageinfo[0]!.thumburl
      routes[u] = { type: 'image/png', body: pngFor(u) }
    }
    for (const r of OPENVERSE_RESPONSE.results) routes[r.url] = { type: 'image/jpeg', body: pngFor(r.url) }
    // The top CC0 Commons hit serves something that is not an image: skipped.
    routes[COMMONS_RESPONSE.query.pages['902'].imageinfo[0]!.thumburl] = { type: 'image/png', body: '<svg onload=x>' }
    const { fetcher, seen } = fakeFetcher(routes)
    const api: Fetcher = async (url, o) =>
      url.startsWith('https://commons.wikimedia.org/w/api.php?')
        ? { url, status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify(COMMONS_RESPONSE)) }
        : url.startsWith('https://api.openverse.org/v1/images/?')
          ? { url, status: 200, contentType: 'application/json', body: Buffer.from(JSON.stringify(OPENVERSE_RESPONSE)) }
          : fetcher(url, o)
    return { api, seen }
  }

  it('stores only auto-usable licensed images with attribution, preferring photos', async () => {
    const { api, seen } = apis()
    let apiUrls: string[] = []
    const spy: Fetcher = (url, o) => (url.includes('?') && apiUrls.push(url), api(url, o))
    const refs = await findLicensedImages(
      handle.db,
      { query: 'Saab Gripen', count: 3 },
      { fetcher: spy, dataDir, env: {} },
    )
    // Commons first; Openverse only fills up.
    expect(refs.map((r) => [r.alt, r.license.license])).toEqual([
      ['A Gripen fighter in flight & banking', 'CC-BY-SA-4.0'],
      ['Gripen NASA', 'PD'],
      ['Volvo PV444 a1', 'CC-BY-SA-2.0'],
    ])
    expect(refs.every((r) => r.license.autoUsable && !r.generated && r.license.attribution)).toBe(true)
    expect(apiUrls.find((u) => u.includes('commons'))).toContain('filetype%3Abitmap')
    expect(apiUrls.find((u) => u.includes('openverse'))).toContain('category=photograph')
    expect(seen.some((u) => u.includes('a3_b'))).toBe(false) // NC never downloaded
    apiUrls = []
  })

  it('returns nothing (and fetches nothing) when disabled', async () => {
    const { api } = apis()
    let calls = 0
    const counting: Fetcher = (u, o) => (calls++, api(u, o))
    expect(
      await findLicensedImages(
        handle.db,
        { query: 'x', count: 2 },
        { fetcher: counting, dataDir, env: { FEATURE_EXTERNAL_ASSETS: 'false' } },
      ),
    ).toEqual([])
    expect(calls).toBe(0)
  })
})

describe('feature flags', () => {
  const tools = (): JobTools =>
    ({
      db: handle.db,
      log: silentLog,
      signal: new AbortController().signal,
      progress: async () => {},
      fail: (c: string, m: string, r: boolean) => {
        throw new JobFailure(c, m, r)
      },
    }) as unknown as JobTools
  const job = (payload: Record<string, unknown>) => ({ payload }) as never

  it('researchBrief returns null when disabled or unconfigured; jobs fail with feature_disabled', async () => {
    const ai = aiWith(results, () => ({}))
    const off = { FEATURE_WEB_RESEARCH: 'false' }
    expect(await researchBrief(handle.db, ai, { topic: 'x' }, { env: off })).toBeNull()
    expect(await researchBrief(handle.db, { ...ai, research: undefined }, { topic: 'x' }, { env: {} })).toBeNull()
    const deps = {
      db: handle.db,
      env: { ...TEST_ENV, DATA_DIR: dataDir },
      ai,
      log: silentLog,
    } as unknown as HandlerDeps
    const [research, asset] = researchJobHandlers(deps, { ...off, FEATURE_EXTERNAL_ASSETS: 'false' })
    await expect(research!.run(job({}), tools())).rejects.toMatchObject({ jobError: { code: 'bad_payload' } })
    await expect(research!.run(job({ topic: 'Gripen' }), tools())).rejects.toMatchObject({
      jobError: { code: 'feature_disabled', retryable: false },
    })
    await expect(asset!.run(job({ query: 'Gripen' }), tools())).rejects.toMatchObject({
      jobError: { code: 'no_assets' },
    })
  })
})

describe('routes', () => {
  it('serves attribution to everyone and provenance to adults only', async () => {
    const t = await createTestApp()
    try {
      const row = await storeAsset(t.db, dataDir, {
        data: Buffer.concat([MOCK_PNG, Buffer.from('route')]),
        mimeType: 'image/png',
        alt: 'Gripen',
        generated: false,
        license: {
          license: 'CC-BY-SA-4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
          creator: 'E',
          attribution: '”Gripen”, av E, licens: CC BY-SA 4.0',
          sourceUrl: 'https://commons.wikimedia.org/wiki/File:G.jpg',
          provider: 'Wikimedia Commons',
          retrievedAt: '2026-10-01T00:00:00.000Z',
          autoUsable: true,
        },
      })
      const a = await t.app.inject({ url: `/api/v1/assets/${row.id}/attribution` })
      expect(a.statusCode).toBe(200)
      expect(a.json()).toMatchObject({ attributionRequired: true, attribution: '”Gripen”, av E, licens: CC BY-SA 4.0' })
      expect((await t.app.inject({ url: `/api/v1/assets/${crypto.randomUUID()}/attribution` })).statusCode).toBe(404)

      const [b] = await t.db
        .insert(researchBriefs)
        .values({ topic: 'Gripen', language: 'sv', brief: { summary: 's', keyPoints: [{ text: 't', sources: [1] }] } })
        .returning()
      await t.db.insert(researchSources).values({
        briefId: b!.id,
        index: 1,
        url: 'https://a.example/',
        title: 'A',
        retrievedAt: new Date(),
        excerpt: 'kort',
      })
      const url = `/api/v1/research/provenance?briefIds=${b!.id}&assetIds=${row.id}`
      expect((await t.app.inject({ url })).statusCode).toBe(403)
      const p = await t.app.inject({ url, headers: asAdult })
      expect(p.statusCode).toBe(200)
      expect(p.json().briefs[0].sources[0]).toMatchObject({
        index: 1,
        kind: 'web',
        url: 'https://a.example/',
        excerpt: 'kort',
      })
      expect(p.json().assets[0].license.provider).toBe('Wikimedia Commons')
      expect(
        (await t.app.inject({ url: '/api/v1/research/provenance?briefIds=nope', headers: asAdult })).statusCode,
      ).toBe(400)
    } finally {
      await t.close()
    }
  })
})
