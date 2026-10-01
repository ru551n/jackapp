import { createHash } from 'node:crypto'
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'
import { CurriculumRef, SchoolPosition, type SubjectCode } from '../../shared/contracts'
import type { Db } from '../db/client'
import { curriculumItems, curriculumSubjects, curriculumVersions } from '../db/schema'
import { HttpError } from '../gate/guards'
import { fetchSnapshot, yearsOfSpan } from './import'
import { CurriculumSnapshot, loadBundledSnapshot } from './snapshot'

type Log = { info(obj: object, msg?: string): void }
type SubjectRow = typeof curriculumSubjects.$inferSelect
type ItemRow = typeof curriculumItems.$inferSelect

// ---------- sync ----------

const chunks = <T>(xs: T[], n = 500) =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

/** Stores a snapshot (idempotent per version and content) and makes it the active version. */
export async function syncCurriculumSnapshot(db: Db, input: CurriculumSnapshot) {
  const snap = CurriculumSnapshot.parse(input)
  const contentHash = createHash('sha256').update(JSON.stringify(snap)).digest('hex')
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(curriculumVersions).where(eq(curriculumVersions.version, snap.version))
    const changed = existing?.contentHash !== contentHash
    if (changed) {
      if (existing) await tx.delete(curriculumVersions).where(eq(curriculumVersions.version, snap.version))
      await tx.insert(curriculumVersions).values({
        version: snap.version,
        source: snap.source,
        retrievedAt: new Date(snap.retrievedAt),
        apiVersion: snap.apiVersion,
        licence: snap.licence,
        sourceUrls: snap.sourceUrls,
        contentHash,
      })
      for (const part of chunks(snap.subjects.map(({ items: _, ...s }) => ({ ...s, version: snap.version }))))
        await tx.insert(curriculumSubjects).values(part)
      const items = snap.subjects.flatMap((s) =>
        s.items.map((i, position) => ({ ...i, version: snap.version, subjectCode: s.code, position })),
      )
      for (const part of chunks(items)) await tx.insert(curriculumItems).values(part)
    }
    await tx.update(curriculumVersions).set({ active: false }).where(ne(curriculumVersions.version, snap.version))
    await tx.update(curriculumVersions).set({ active: true }).where(eq(curriculumVersions.version, snap.version))
    if (changed) docCache.clear()
    return { version: snap.version, changed }
  })
}

/** Switch back to an already stored version. */
export async function activateCurriculumVersion(db: Db, version: string) {
  const [v] = await db.select().from(curriculumVersions).where(eq(curriculumVersions.version, version))
  if (!v) throw new HttpError(404, 'not_found', 'Läroplansversionen finns inte.')
  await db.transaction(async (tx) => {
    await tx.update(curriculumVersions).set({ active: false }).where(ne(curriculumVersions.version, version))
    await tx.update(curriculumVersions).set({ active: true }).where(eq(curriculumVersions.version, version))
  })
}

/** Startup/migrate hook: load the committed snapshot unless an equal or newer version is already active. */
export async function syncBundledCurriculum(db: Db, log?: Log) {
  const snap = loadBundledSnapshot()
  const current = await activeVersion(db).catch(() => undefined)
  if (current && current >= snap.version) return { version: current, changed: false }
  const r = await syncCurriculumSnapshot(db, snap)
  log?.info({ version: r.version, changed: r.changed }, 'curriculum snapshot synced')
  return r
}

/** Job handlers; the orchestrator wires them into the worker registry. */
export const curriculumJobHandlers = {
  /** Fetch the live Skolverket API and store it as a new active version. */
  'curriculum.sync': async (db: Db, log: Log) => {
    const r = await syncCurriculumSnapshot(db, await fetchSnapshot())
    log.info({ version: r.version, changed: r.changed }, 'curriculum fetched from Skolverket')
  },
}

// ---------- queries ----------

export async function activeVersion(db: Db): Promise<string> {
  const [v] = await db
    .select({ version: curriculumVersions.version })
    .from(curriculumVersions)
    .where(eq(curriculumVersions.active, true))
  if (!v) throw new HttpError(503, 'curriculum_unavailable', 'Läroplanen är inte inläst ännu.')
  return v.version
}

/**
 * Which gymnasium reform a student in programme year `year` follows: GY25 (subjects with levels)
 * for students starting on or after 1 July 2025, otherwise GY11 (courses).
 */
export function gyReformFor(year: number, asOf = new Date()): 'GY11' | 'GY25' {
  const schoolYearStart = asOf.getUTCMonth() >= 6 ? asOf.getUTCFullYear() : asOf.getUTCFullYear() - 1
  return schoolYearStart - (year - 1) >= 2025 ? 'GY25' : 'GY11'
}

/** Does an item span apply to a school year? Course/level codes and "F" are not year-bound. */
export function spanCovers(span: string | null | undefined, year: number): boolean {
  if (!span) return true
  const years = yearsOfSpan(span)
  return years.length === 0 || years.includes(year)
}

export async function subjectsFor(db: Db, position: SchoolPosition, opts: { asOf?: Date } = {}) {
  const p = SchoolPosition.parse(position)
  const version = await activeVersion(db)
  const rows = await db
    .select()
    .from(curriculumSubjects)
    .where(
      and(
        eq(curriculumSubjects.version, version),
        eq(curriculumSubjects.stage, p.stage),
        sql`${curriculumSubjects.applicableYears} @> ${JSON.stringify([p.year])}::jsonb`,
        p.stage === 'gymnasieskola' ? eq(curriculumSubjects.reform, gyReformFor(p.year, opts.asOf)) : undefined,
      ),
    )
    .orderBy(asc(curriculumSubjects.name), asc(curriculumSubjects.code))
  return rows.map(publicSubject)
}

const publicSubject = ({ purpose: _, ...s }: SubjectRow) => s
const publicItem = ({ version: _v, subjectCode: _s, position: _p, ...i }: ItemRow) => i

/** One subject with its items; with `year`, grundskola content is limited to the span covering that year. */
export async function subject(db: Db, code: SubjectCode, year?: number) {
  const version = await activeVersion(db)
  const [s] = await db
    .select()
    .from(curriculumSubjects)
    .where(and(eq(curriculumSubjects.version, version), eq(curriculumSubjects.code, code)))
  if (!s) return null
  const items = await db
    .select()
    .from(curriculumItems)
    .where(and(eq(curriculumItems.version, version), eq(curriculumItems.subjectCode, code)))
    .orderBy(asc(curriculumItems.position))
  return {
    ...s,
    items: items.filter((i) => year === undefined || spanCovers(i.span, year)).map(publicItem),
  }
}

const toRef = (version: string, stage: string, i: Pick<ItemRow, 'subjectCode' | 'span' | 'id'>): CurriculumRef =>
  CurriculumRef.parse({
    source: 'skolverket',
    version,
    subjectCode: i.subjectCode,
    stage,
    span: i.span ?? undefined,
    itemId: i.id,
  })

/** Refs to the central content of a subject (for the span covering `year`, when given). */
export async function refsFor(db: Db, code: SubjectCode, year?: number): Promise<CurriculumRef[]> {
  const s = await subject(db, code, year)
  if (!s) return []
  return s.items
    .filter((i) => i.kind === 'central_content')
    .map((i) => toRef(s.version, s.stage, { ...i, subjectCode: s.code }))
}

/** True only if the ref points at stored curriculum (version, subject, stage, span and item agree). */
export async function isValidRef(db: Db, ref: unknown): Promise<boolean> {
  const r = CurriculumRef.safeParse(ref)
  if (!r.success) return false
  const { version, subjectCode, stage, span, itemId } = r.data
  const [s] = await db
    .select({ stage: curriculumSubjects.stage })
    .from(curriculumSubjects)
    .where(and(eq(curriculumSubjects.version, version), eq(curriculumSubjects.code, subjectCode)))
  if (!s || s.stage !== stage) return false
  if (!itemId && !span) return true
  const [i] = await db
    .select({ id: curriculumItems.id })
    .from(curriculumItems)
    .where(
      and(
        eq(curriculumItems.version, version),
        eq(curriculumItems.subjectCode, subjectCode),
        itemId ? eq(curriculumItems.id, itemId) : undefined,
        span ? eq(curriculumItems.span, span) : undefined,
      ),
    )
    .limit(1)
  return !!i
}

/**
 * `isValidRef` plus a position check for request resolution: the ref's stage must be the learner's,
 * its subject must apply to the learner's year (and gymnasium reform), and its span must cover the year.
 */
export async function isValidRefFor(
  db: Db,
  ref: unknown,
  position: SchoolPosition,
  opts: { asOf?: Date } = {},
): Promise<boolean> {
  if (!(await isValidRef(db, ref))) return false
  const r = CurriculumRef.parse(ref)
  const p = SchoolPosition.parse(position)
  if (r.stage !== p.stage) return false
  if (p.stage !== 'gymnasieskola' && !spanCovers(r.span, p.year)) return false
  const [s] = await db
    .select({ years: curriculumSubjects.applicableYears, reform: curriculumSubjects.reform })
    .from(curriculumSubjects)
    .where(and(eq(curriculumSubjects.version, r.version), eq(curriculumSubjects.code, r.subjectCode)))
  if (!s || !s.years.includes(p.year)) return false
  return p.stage !== 'gymnasieskola' || s.reform === gyReformFor(p.year, opts.asOf)
}

// ---------- suggestRefs: deterministic BM25 over central content ----------

const STOPWORDS = new Set(
  (
    'och i att det som en på är av för med till den har de inte om ett men var sig från vi så kan man när ska hur ' +
    'vad eller samt även deras dess sina sin sitt olika några andra genom inom vid efter under mellan mot där detta ' +
    'dessa denna vilka vilken utan'
  ).split(' '),
)
// Longest first; a light Swedish suffix stripper (keeps stems ≥ 3 letters).
const SUFFIXES = [
  'heterna', 'hetens', 'arnas', 'ernas', 'ornas', 'andet', 'andes', 'heten', 'heter', 'arna', 'erna', 'orna',
  'ande', 'ende', 'aste', 'het', 'ast', 'are', 'ens', 'ets', 'arn', 'ern', 'orn', 'ar', 'er', 'or', 'en', 'et',
  'na', 'a', 'e', 's',
] // prettier-ignore

export function stem(w: string): string {
  for (const s of SUFFIXES) if (w.endsWith(s) && w.length - s.length >= 3) return w.slice(0, -s.length)
  return w
}

export function tokenize(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize('NFC')
      .match(/[\p{L}\p{N}]+/gu) ?? []
  )
    .filter((w) => !STOPWORDS.has(w))
    .map(stem)
}

/**
 * Everyday words → the curriculum's own wording (Lgr22). Keys are word prefixes; values are added
 * to the query. Keep it small and boring: only core concepts adults and children actually type.
 */
const SYNONYMS: [prefix: string, adds: string][] = [
  ['multiplik', 'räknesätt multiplikation'],
  ['divi', 'räknesätt division'],
  ['addit', 'räknesätt addition'],
  ['subtrak', 'räknesätt subtraktion'],
  ['gånger', 'räknesätt'],
  ['plus', 'räknesätt'],
  ['minus', 'räknesätt'],
  ['räkna', 'räknesätt'],
  ['klocka', 'tid mätning'],
  ['klockan', 'tid mätning'],
  ['klockor', 'tid mätning'],
  ['glosor', 'ordförråd ord'],
  ['glosa', 'ordförråd ord'],
  ['bråk', 'bråkform rationella tal'],
  ['decimal', 'decimalform rationella tal'],
  ['pengar', 'ekonomi'],
  ['kropp', 'människokroppen'],
  ['vikinga', 'vikingar 800–1500'],
  ['medeltid', 'medeltidens 800–1500'],
  ['former', 'geometriska objekt'],
  ['figurer', 'geometriska objekt'],
  ['skrivstil', 'handskrift'],
  ['läsförståelse', 'lässtrategier'],
]

const YEAR_PHRASE = /(?<![\p{L}\d])(?:åk|årskurs|klass)\.?\s*(\d{1,2})(?!\d)/iu

/** Pull "åk 4" / "årskurs 4" / "klass 4" out of a query: the number is a school year, not a search term. */
export function parseQuery(text: string): { text: string; year?: number } {
  const m = YEAR_PHRASE.exec(text)
  if (!m) return { text }
  return { text: text.replace(YEAR_PHRASE, ' '), year: Number(m[1]) }
}

/** Query tokens: stemmed words plus curated synonyms. */
export function queryTokens(text: string): string[] {
  const words =
    text
      .toLowerCase()
      .normalize('NFC')
      .match(/[\p{L}\p{N}]+/gu) ?? []
  const extra = words.flatMap((w) => SYNONYMS.filter(([p]) => w.startsWith(p)).map(([, adds]) => adds))
  return [...new Set(tokenize([text, ...extra].join(' ')))]
}

/** Exact stem match, or a shared prefix for longer stems (fotosyntes ~ fotosynte, vikingatid ~ viking). */
const MIN_PREFIX = 5
export function termMatches(q: string, d: string): boolean {
  if (q === d) return true
  return Math.min(q.length, d.length) >= MIN_PREFIX && (d.startsWith(q) || q.startsWith(d))
}

export interface SuggestedRef {
  ref: CurriculumRef
  score: number
  subjectName: string
  kind: string
  area: string | null
  text: string
}

interface DocSet {
  items: ItemRow[]
  docs: string[][]
  vocab: string[]
}
/** Tokenized central content per (version, subjects, year). Cleared when a snapshot changes. */
const docCache = new Map<string, Promise<DocSet>>()
const DOC_CACHE_MAX = 64

function loadDocs(db: Db, version: string, codes: string[], year: number): Promise<DocSet> {
  const key = `${version}|${year}|${[...codes].sort().join(',')}`
  let hit = docCache.get(key)
  if (!hit) {
    if (docCache.size >= DOC_CACHE_MAX) docCache.clear() // ponytail: wholesale clear, LRU if keys churn
    hit = db
      .select()
      .from(curriculumItems)
      .where(
        and(
          eq(curriculumItems.version, version),
          inArray(curriculumItems.subjectCode, codes),
          inArray(curriculumItems.kind, ['central_content', 'goal']),
        ),
      )
      .then((rows) => {
        const items = rows.filter((i) => spanCovers(i.span, year))
        const docs = items.map((i) => tokenize(`${i.area ?? ''} ${i.text}`))
        return { items, docs, vocab: [...new Set(docs.flat())] }
      })
    hit.catch(() => docCache.delete(key))
    docCache.set(key, hit)
  }
  return hit
}

/**
 * Ranked candidate refs for a text, limited to subjects/spans applicable to the position.
 * Deterministic (BM25 with prefix matching and synonyms, ties by id); generation passes these to
 * the AI as the only allowed refs. "åk 4" in the text overrides the grundskola year.
 * ponytail: scores in memory (~10k items max, docs cached); add a tsvector index if it gets slow.
 */
export async function suggestRefs(
  db: Db,
  q: { position: SchoolPosition; subjectCode?: SubjectCode; text: string; limit?: number; asOf?: Date },
): Promise<SuggestedRef[]> {
  const parsed = parseQuery(q.text)
  const position =
    q.position.stage === 'grundskola' && parsed.year && parsed.year >= 1 && parsed.year <= 9
      ? { ...q.position, year: parsed.year }
      : q.position
  const query = queryTokens(parsed.text)
  if (query.length === 0) return []
  const subjects = (await subjectsFor(db, position, { asOf: q.asOf })).filter(
    (s) => !q.subjectCode || s.code === q.subjectCode,
  )
  if (subjects.length === 0) return []
  const byCode = new Map(subjects.map((s) => [s.code, s]))
  const version = subjects[0]!.version
  const { items, docs, vocab } = await loadDocs(db, version, [...byCode.keys()], position.year)

  // Each query term matches a set of document terms (exact or prefix); df counts docs with any of them.
  const matchSets = query.map((t) => new Set(vocab.filter((v) => termMatches(t, v))))
  const avgLen = docs.reduce((n, d) => n + d.length, 0) / Math.max(docs.length, 1)
  const k1 = 1.2
  const b = 0.75
  const tfs = docs.map((d) => matchSets.map((m) => (m.size ? d.filter((x) => m.has(x)).length : 0)))
  const df = matchSets.map((_, k) => tfs.filter((row) => row[k]! > 0).length)
  const scored = items.map((item, n) => {
    const d = docs[n]!
    let score = 0
    query.forEach((_, k) => {
      const tf = tfs[n]![k]!
      if (!tf) return
      const idf = Math.log(1 + (items.length - df[k]! + 0.5) / (df[k]! + 0.5))
      score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * d.length) / avgLen))
    })
    return { item, score }
  })
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
    .slice(0, q.limit ?? 10)
    .map(({ item, score }) => {
      const s = byCode.get(item.subjectCode)!
      return {
        ref: toRef(version, s.stage, item),
        score: Math.round(score * 1000) / 1000,
        subjectName: s.name,
        kind: item.kind,
        area: item.area,
        text: item.text,
      }
    })
}
