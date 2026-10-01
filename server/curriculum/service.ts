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

export interface SuggestedRef {
  ref: CurriculumRef
  score: number
  subjectName: string
  kind: string
  area: string | null
  text: string
}

/**
 * Ranked candidate refs for a text, limited to subjects/spans applicable to the position.
 * Deterministic (BM25, ties by id); generation passes these to the AI as the only allowed refs.
 * ponytail: scores in memory per call (~10k items max); add a tsvector index if it gets slow.
 */
export async function suggestRefs(
  db: Db,
  q: { position: SchoolPosition; subjectCode?: SubjectCode; text: string; limit?: number; asOf?: Date },
): Promise<SuggestedRef[]> {
  const query = [...new Set(tokenize(q.text))]
  if (query.length === 0) return []
  const subjects = (await subjectsFor(db, q.position, { asOf: q.asOf })).filter(
    (s) => !q.subjectCode || s.code === q.subjectCode,
  )
  if (subjects.length === 0) return []
  const byCode = new Map(subjects.map((s) => [s.code, s]))
  const version = subjects[0]!.version
  const items = (
    await db
      .select()
      .from(curriculumItems)
      .where(
        and(
          eq(curriculumItems.version, version),
          inArray(curriculumItems.subjectCode, [...byCode.keys()]),
          inArray(curriculumItems.kind, ['central_content', 'goal']),
        ),
      )
  ).filter((i) => spanCovers(i.span, q.position.year))

  const docs = items.map((i) => tokenize(`${i.area ?? ''} ${i.text}`))
  const avgLen = docs.reduce((n, d) => n + d.length, 0) / Math.max(docs.length, 1)
  const df = new Map<string, number>()
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1)
  const k1 = 1.2
  const b = 0.75
  const scored = items.map((item, n) => {
    const d = docs[n]!
    let score = 0
    for (const t of query) {
      const tf = d.filter((x) => x === t).length
      if (!tf) continue
      const idf = Math.log(1 + (items.length - df.get(t)! + 0.5) / (df.get(t)! + 0.5))
      score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * d.length) / avgLen))
    }
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
