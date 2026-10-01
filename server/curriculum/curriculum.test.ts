import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { count, eq } from 'drizzle-orm'
import { createTestDb } from '../db/client'
import { curriculumItems, curriculumVersions } from '../db/schema'
import { createTestApp } from '../test/helpers'
import { htmlToText, makeItems, parseContentBlocks, spanForRequirementYear, yearsOfSpan } from './import'
import { CurriculumSnapshot, loadBundledSnapshot } from './snapshot'
import {
  activateCurriculumVersion,
  activeVersion,
  gyReformFor,
  isValidRef,
  isValidRefFor,
  parseQuery,
  queryTokens,
  refsFor,
  spanCovers,
  subject,
  subjectsFor,
  suggestRefs,
  syncBundledCurriculum,
  syncCurriculumSnapshot,
  termMatches,
  tokenize,
} from './service'

const AS_OF = new Date('2026-10-01T12:00:00Z')

const fixture = (version: string, text = 'Naturliga tal och deras egenskaper.'): CurriculumSnapshot => ({
  source: 'skolverket',
  version,
  retrievedAt: `${version}T08:00:00.000Z`,
  apiVersion: 'test',
  licence: 'CC0 1.0',
  sourceUrls: ['https://api.skolverket.se/syllabus/v1/subjects/GRGRMAT01'],
  subjects: [
    {
      code: 'GRGRMAT01',
      name: 'Matematik',
      stage: 'grundskola',
      applicableYears: [1, 2, 3],
      syllabusType: 'COURSE_SYLLABUS',
      categories: [],
      schoolTypes: ['GR'],
      purpose: 'Syfte.',
      courses: [],
      sourceUrl: 'https://api.skolverket.se/syllabus/v1/subjects/GRGRMAT01',
      items: makeItems('GRGRMAT01', [{ kind: 'central_content', span: '1-3', area: 'Taluppfattning', text }]),
    },
  ],
})

describe('normalization', () => {
  it('turns Skolverket HTML into clean text and items', () => {
    expect(htmlToText('<p>hi&shy;sto­rien&nbsp;&ndash; &#229;r</p>')).toBe('historien – år')
    const blocks = parseContentBlocks(
      '<h3>I årskurs 1–3</h3><h4>Algebra</h4><ul><li>Mönster.</li></ul>' +
        '<p>Undervisningen ska behandla följande centrala innehåll:</p><p><strong>Geometri</strong></p><ul><li>Former.</li></ul>',
    )
    expect(blocks).toEqual([
      { section: undefined, area: 'Algebra', text: 'Mönster.' },
      { section: undefined, area: 'Geometri', text: 'Former.' },
    ])
  })

  it('maps spans and grading points', () => {
    expect(yearsOfSpan('4-6')).toEqual([4, 5, 6])
    expect(yearsOfSpan('MATE1A00X')).toEqual([])
    expect(['1', '3', '6', '9'].map(spanForRequirementYear)).toEqual(['1-3', '1-3', '4-6', '7-9'])
    expect(spanCovers('4-6', 5)).toBe(true)
    expect(spanCovers('4-6', 7)).toBe(false)
    expect(spanCovers('MATE1A00X', 2)).toBe(true)
    expect(spanCovers(null, 9)).toBe(true)
  })

  it('derives stable item ids from subject, span and text', () => {
    const a = makeItems('X', [{ kind: 'central_content', span: '1-3', text: 'A' }])
    const b = makeItems('X', [{ kind: 'central_content', span: '1-3', text: 'A' }])
    expect(a[0]!.id).toBe(b[0]!.id)
    expect(a[0]!.id).toMatch(/^X:1-3:cc:[0-9a-f]{12}$/)
    const dup = makeItems('X', [
      { kind: 'goal', text: 'A' },
      { kind: 'goal', text: 'A' },
    ])
    expect(new Set(dup.map((i) => i.id)).size).toBe(2)
  })

  it('stems Swedish lightly', () => {
    expect(tokenize('Växterna och DJUREN i skogen')).toEqual(['växt', 'djur', 'skog'])
    expect(tokenize('ekvationer')).toEqual(tokenize('ekvation'))
  })

  it('parses school years out of queries and expands synonyms', () => {
    expect(parseQuery('multiplikation åk 4')).toEqual({ text: 'multiplikation  ', year: 4 })
    expect(parseQuery('Årskurs 7 fotosyntes').year).toBe(7)
    expect(parseQuery('klass 3: klockan').year).toBe(3)
    expect(parseQuery('tal upp till 100').year).toBeUndefined()
    expect(queryTokens(parseQuery('multiplikation åk 4').text)).toContain('räknesätt')
    expect(queryTokens('klockan')).toContain('tid')
    expect(queryTokens('glosor')).toContain('ordförråd')
    expect(termMatches('fotosyntes', 'fotosynte')).toBe(true)
    expect(termMatches('vikingatid', 'viking')).toBe(true)
    expect(termMatches('tid', 'tidslinj')).toBe(false) // short stems match exactly only
  })

  it('maps gymnasium programme years to the reform in force', () => {
    expect(gyReformFor(1, AS_OF)).toBe('GY25')
    expect(gyReformFor(2, AS_OF)).toBe('GY25')
    expect(gyReformFor(3, AS_OF)).toBe('GY11')
    expect(gyReformFor(2, new Date('2026-03-01'))).toBe('GY11')
  })
})

describe('bundled snapshot', () => {
  const snap = loadBundledSnapshot()

  it('validates and covers förskoleklass, grundskola and gymnasieskola', () => {
    expect(snap.source).toBe('skolverket')
    expect(new Set(snap.subjects.map((s) => s.stage))).toEqual(
      new Set(['forskoleklass', 'grundskola', 'gymnasieskola']),
    )
    const ids = snap.subjects.flatMap((s) => s.items.map((i) => i.id))
    expect(new Set(ids).size).toBe(ids.length)
    for (const code of ['GRGRMAT01', 'GRGRSVE01', 'GRGRSVA01', 'GRGRENG01', 'GRGRMSP01', 'MATE', 'MAT', 'SVEN'])
      expect(snap.subjects.some((s) => s.code === code)).toBe(true)
  })

  it('rejects malformed snapshots', () => {
    expect(CurriculumSnapshot.safeParse({ ...snap, source: 'ai' }).success).toBe(false)
    expect(CurriculumSnapshot.safeParse({ ...snap, version: 'latest' }).success).toBe(false)
  })
})

describe('sync', () => {
  it('is idempotent per version and switches versions', async () => {
    const { db, close } = await createTestDb()
    try {
      expect(await syncCurriculumSnapshot(db, fixture('2026-01-01'))).toEqual({ version: '2026-01-01', changed: true })
      expect(await syncCurriculumSnapshot(db, fixture('2026-01-01'))).toEqual({ version: '2026-01-01', changed: false })
      const [{ n }] = (await db.select({ n: count() }).from(curriculumItems)) as [{ n: number }]
      expect(n).toBe(1)

      await syncCurriculumSnapshot(db, fixture('2026-02-01', 'Rationella tal.'))
      expect(await activeVersion(db)).toBe('2026-02-01')
      expect((await subject(db, 'GRGRMAT01'))!.items[0]!.text).toBe('Rationella tal.')

      // Same version, changed content: replaced, not duplicated.
      await syncCurriculumSnapshot(db, fixture('2026-02-01', 'Tal i bråkform.'))
      expect((await subject(db, 'GRGRMAT01'))!.items.map((i) => i.text)).toEqual(['Tal i bråkform.'])

      await activateCurriculumVersion(db, '2026-01-01')
      expect(await activeVersion(db)).toBe('2026-01-01')
      const active = await db.select().from(curriculumVersions).where(eq(curriculumVersions.active, true))
      expect(active).toHaveLength(1)
    } finally {
      await close()
    }
  })
})

describe('queries and routes on the bundled snapshot', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>
  beforeAll(async () => {
    t = await createTestApp()
    await syncBundledCurriculum(t.db)
  }, 120_000)
  afterAll(async () => t.close())

  const codes = async (stage: 'forskoleklass' | 'grundskola' | 'gymnasieskola', year: number) =>
    (await subjectsFor(t.db, { stage, year }, { asOf: AS_OF })).map((s) => s.code)

  it('does not resync an already active snapshot', async () => {
    expect((await syncBundledCurriculum(t.db)).changed).toBe(false)
  })

  it('subjectsFor per stage and year', async () => {
    expect(await codes('forskoleklass', 0)).toEqual(['LGR22-FK'])
    const y1 = await codes('grundskola', 1)
    for (const c of ['GRGRMAT01', 'GRGRSVE01', 'GRGRSVA01', 'GRGRENG01', 'GRGRBIO01', 'GRGRIDR01', 'GRGRMUS01'])
      expect(y1).toContain(c)
    expect(y1).not.toContain('GRGRMSP01')
    expect(await codes('grundskola', 4)).toContain('GRGRMSP01')
    const y7 = await codes('grundskola', 7)
    expect(y7).toContain('GRGRJUD01')
    expect(y7).toContain('GRGRHKK01')
    const gy1 = await codes('gymnasieskola', 1)
    expect(gy1).toContain('MATE')
    expect(gy1).not.toContain('MAT')
    expect(await codes('gymnasieskola', 3)).toContain('MAT')
  })

  it('subject() limits grundskola content to the span covering the year', async () => {
    const spans = async (year: number) =>
      new Set(
        (await subject(t.db, 'GRGRMAT01', year))!.items.filter((i) => i.kind === 'central_content').map((i) => i.span),
      )
    expect(await spans(2)).toEqual(new Set(['1-3']))
    expect(await spans(5)).toEqual(new Set(['4-6']))
    expect(await spans(9)).toEqual(new Set(['7-9']))
    const refs = await refsFor(t.db, 'GRGRMAT01', 8)
    expect(refs.length).toBeGreaterThan(10)
    expect(refs.every((r) => r.span === '7-9' && r.stage === 'grundskola' && r.itemId)).toBe(true)
  })

  it('suggestRefs ranks matching Swedish central content first', async () => {
    const pos = { stage: 'grundskola' as const, year: 2 }
    const [top] = await suggestRefs(t.db, { position: pos, text: 'Hur fungerar positionssystemet för talen?' })
    expect(top!.ref).toMatchObject({ subjectCode: 'GRGRMAT01', span: '1-3' })
    expect(top!.text).toMatch(/Positionssystemet/)

    const bio = await suggestRefs(t.db, { position: pos, text: 'växterna och djuren i närmiljön', limit: 3 })
    expect(bio[0]!.ref.subjectCode).toMatch(/^GRGR(BIO|GEO)01$/)
    expect(bio.every((r) => r.ref.span === '1-3' || r.ref.span === undefined)).toBe(true)

    const onlySve = await suggestRefs(t.db, { position: pos, subjectCode: 'GRGRSVE01', text: 'ljud och bokstäver' })
    expect(onlySve.length).toBeGreaterThan(0)
    expect(onlySve.every((r) => r.ref.subjectCode === 'GRGRSVE01')).toBe(true)

    const again = await suggestRefs(t.db, { position: pos, text: 'Hur fungerar positionssystemet för talen?' })
    expect(again[0]!.ref).toEqual(top!.ref)
    expect(await suggestRefs(t.db, { position: pos, text: 'och i att' })).toEqual([])
  })

  it.each([
    // [query, learner year, expected subject, expected span, text pattern]
    ['multiplikation åk 4', 2, 'GRGRMAT01', '4-6', /räknesätt/],
    ['multiplikationstabellen', 3, 'GRGRMAT01', '1-3', /räknesätt/],
    ['fotosyntesen', 8, 'GRGRBIO01', '7-9', /Fotosyntes/],
    ['fotosyntes', 8, 'GRGRBIO01', '7-9', /Fotosyntes/],
    ['vikingatiden', 5, 'GRGRHIS01', '4-6', /vikingar/],
    ['klockan', 2, 'GRGRMAT01', '1-3', /tid/],
    ['division och subtraktion', 5, 'GRGRMAT01', '4-6', /räknesätt/],
  ] as const)('suggestRefs finds "%s" (åk %i)', async (text, year, code, span, re) => {
    const [top] = await suggestRefs(t.db, { position: { stage: 'grundskola', year }, text, limit: 3 })
    expect(top?.ref).toMatchObject({ subjectCode: code, span })
    expect(top!.text).toMatch(re)
  })

  it('isValidRef accepts stored refs and rejects invented ones', async () => {
    const [good] = await refsFor(t.db, 'GRGRSVE01', 1)
    expect(await isValidRef(t.db, good)).toBe(true)
    expect(await isValidRef(t.db, { ...good, itemId: 'GRGRSVE01:1-3:cc:000000000000' })).toBe(false)
    expect(await isValidRef(t.db, { ...good, span: '7-9' })).toBe(false)
    expect(await isValidRef(t.db, { ...good, stage: 'gymnasieskola' })).toBe(false)
    expect(await isValidRef(t.db, { ...good, version: '1999-01-01' })).toBe(false)
    expect(await isValidRef(t.db, { ...good, subjectCode: 'GRGRMAT01' })).toBe(false)
    expect(
      await isValidRef(t.db, {
        source: 'skolverket',
        version: good!.version,
        subjectCode: 'MATE',
        stage: 'gymnasieskola',
        span: 'MATE1C00X',
      }),
    ).toBe(true)
    expect(await isValidRef(t.db, { source: 'ai' })).toBe(false)
  })

  it('isValidRefFor also checks the learner position', async () => {
    const [ref] = await refsFor(t.db, 'GRGRMAT01', 2)
    expect(await isValidRefFor(t.db, ref, { stage: 'grundskola', year: 2 })).toBe(true)
    expect(await isValidRefFor(t.db, ref, { stage: 'grundskola', year: 5 })).toBe(false) // span 1-3
    expect(await isValidRefFor(t.db, ref, { stage: 'gymnasieskola', year: 1 })).toBe(false)
    const [msp] = await refsFor(t.db, 'GRGRMSP01', 6)
    expect(await isValidRefFor(t.db, msp, { stage: 'grundskola', year: 6 })).toBe(true)
    expect(
      await isValidRefFor(t.db, { ...msp, span: undefined, itemId: undefined }, { stage: 'grundskola', year: 2 }),
    ).toBe(false) // modersmål/språkval not in åk 2
  })

  it('serves the HTTP API without the adult gate', async () => {
    const list = await t.app.inject('/api/v1/curriculum/subjects?stage=grundskola&year=1')
    expect(list.statusCode).toBe(200)
    expect(list.json().subjects.map((s: { code: string }) => s.code)).toContain('GRGRMAT01')
    expect((await t.app.inject('/api/v1/curriculum/subjects?stage=grundskola&year=0')).statusCode).toBe(400)
    expect((await t.app.inject('/api/v1/curriculum/subjects?stage=forskoleklass&year=0')).json().subjects).toHaveLength(
      1,
    )

    const one = await t.app.inject('/api/v1/curriculum/subjects/GRGRMAT01?year=5')
    expect(one.statusCode).toBe(200)
    expect(one.json()).toMatchObject({ code: 'GRGRMAT01', stage: 'grundskola', name: 'Matematik' })
    expect((await t.app.inject('/api/v1/curriculum/subjects/NOPE01')).statusCode).toBe(404)

    const search = await t.app.inject(
      `/api/v1/curriculum/search?q=${encodeURIComponent('bråk och procent')}&stage=grundskola&year=5&subject=GRGRMAT01`,
    )
    expect(search.statusCode).toBe(200)
    expect(search.json().results[0].ref).toMatchObject({ source: 'skolverket', subjectCode: 'GRGRMAT01', span: '4-6' })
    expect((await t.app.inject('/api/v1/curriculum/search?q=x&stage=grundskola&year=5')).statusCode).toBe(400)
  })
})
