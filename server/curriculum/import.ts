import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { CurriculumSnapshot, DATA_DIR, type ItemKind, type SnapshotItem, type SnapshotSubject } from './snapshot'

// Fetches Skolverket's Syllabus API (v1, stable; CC0) and normalizes it into a CurriculumSnapshot.
// Run with `npm run curriculum:fetch`; commit the written file. Details: docs/platform/curriculum.md.

export const API_BASE = 'https://api.skolverket.se/syllabus/v1'
const FK_CODE = 'LGR22-FK'

// ---------- HTML → text ----------

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  shy: '',
}

export function htmlToText(html: string): string {
  return html
    .replace(/<\/(p|li|h\d)>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) =>
      e[0] === '#'
        ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
        : (ENTITIES[e.toLowerCase()] ?? m),
    )
    .replace(/­/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const isEmphasisOnly = (inner: string) => /^\s*<(strong|em|i|b)>[\s\S]*<\/\1>\s*$/i.test(inner)

/**
 * Central content HTML → items. h3 = section, h4 / emphasized paragraph = area, li = item.
 * Intro paragraphs ("…ska behandla följande centrala innehåll:") are skipped; other plain
 * paragraphs become items so no official text is lost.
 */
export function parseContentBlocks(html: string) {
  const out: { section?: string; area?: string; text: string }[] = []
  let section: string | undefined
  let area: string | undefined
  for (const m of html.matchAll(/<(h[1-6]|li|p)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const tag = m[1]!.toLowerCase()
    const text = htmlToText(m[2]!)
    if (!/\p{L}/u.test(text)) continue
    if (tag === 'h3' || tag === 'h2') {
      if (text === 'Centralt innehåll') continue
      section = /^I årskurs [\d–-]+$/.test(text) ? undefined : text
      area = undefined
    } else if (tag[0] === 'h' || (tag === 'p' && isEmphasisOnly(m[2]!))) {
      if (!text.endsWith(':')) area = text
    } else if (tag === 'li' || !/(följande|centrala innehåll)[^.]*[:.]$/i.test(text)) {
      out.push({ section, area, text })
    }
  }
  return out
}

/** Knowledge-requirement HTML: headings become section/area, the rest is the text. */
export function parseRequirement(html: string) {
  const headings = [...html.matchAll(/<h\d\b[^>]*>([\s\S]*?)<\/h\d>/gi)].map((m) => htmlToText(m[1]!)).filter(Boolean)
  const text = htmlToText(html.replace(/<h\d\b[^>]*>[\s\S]*?<\/h\d>/gi, ' '))
  return {
    area: headings.at(-1),
    section: headings.length > 1 ? headings.slice(0, -1).join(' – ') : undefined,
    text,
  }
}

/** Purpose list items ("…förmåga att: • …") as long-term goals. */
export const purposeGoals = (html: string) =>
  [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => htmlToText(m[1]!)).filter(Boolean)

// ---------- spans and ids ----------

/** Grundskola grading point (end of year N) → its content span. */
export function spanForRequirementYear(year: string): string {
  const y = Number(year)
  return y <= 3 ? '1-3' : y <= 6 ? '4-6' : '7-9'
}

export function yearsOfSpan(span: string): number[] {
  const m = /^(\d)-(\d)$/.exec(span)
  if (!m) return /^\d$/.test(span) ? [Number(span)] : []
  const out: number[] = []
  for (let y = Number(m[1]); y <= Number(m[2]); y++) out.push(y)
  return out
}

const KIND_TAG: Record<ItemKind, string> = { central_content: 'cc', knowledge_requirement: 'kr', goal: 'goal' }

/** Builds items with stable ids (the API has no item ids: hash of subject+span+kind+context+text). */
export function makeItems(code: string, raw: Omit<SnapshotItem, 'id'>[]): SnapshotItem[] {
  const seen = new Set<string>()
  return raw.map((r) => {
    const h = createHash('sha256')
      .update([code, r.span, r.kind, r.section, r.area, r.gradeStep, r.text].map((x) => x ?? '').join('|'))
      .digest('hex')
      .slice(0, 12)
    let id = `${code}:${r.span ?? '-'}:${KIND_TAG[r.kind]}:${h}`
    for (let n = 2; seen.has(id); n++) id = `${code}:${r.span ?? '-'}:${KIND_TAG[r.kind]}:${h}-${n}`
    seen.add(id)
    return { id, ...r }
  })
}

// ---------- API shapes (only what we read) ----------

interface ApiReq {
  text: string
  year?: string
  gradeStep?: string
}
interface ApiCourse {
  code: string
  name: string
  points?: string
  centralContent?: { text: string }
  knowledgeRequirements?: ApiReq[]
}
interface ApiSubject {
  code: string
  name: string
  typeOfSyllabus: string
  schoolTypes: string[]
  categories?: { code: string }[]
  reform?: string
  startDate?: string
  endDate?: string
  version?: number
  purpose?: string
  centralContents?: { text: string; year: string }[]
  knowledgeRequirements?: ApiReq[]
  courses?: ApiCourse[]
}

const subjectUrl = (code: string) => `${API_BASE}/subjects/${encodeURIComponent(code)}`

export function normalizeGrundskola(s: ApiSubject): SnapshotSubject {
  const raw: Omit<SnapshotItem, 'id'>[] = purposeGoals(s.purpose ?? '').map((text) => ({ kind: 'goal', text }))
  const years = new Set<number>()
  for (const cc of s.centralContents ?? []) {
    const span = cc.year.replace(/[–-]/, '-')
    yearsOfSpan(span).forEach((y) => years.add(y))
    for (const b of parseContentBlocks(cc.text)) raw.push({ kind: 'central_content', span, ...b })
  }
  for (const kr of s.knowledgeRequirements ?? []) {
    const r = parseRequirement(kr.text)
    if (r.text)
      raw.push({
        kind: 'knowledge_requirement',
        span: kr.year ? spanForRequirementYear(kr.year) : undefined,
        gradeStep: kr.gradeStep,
        ...r,
      })
  }
  return {
    ...common(s),
    stage: 'grundskola',
    applicableYears: [...years].sort((a, b) => a - b),
    courses: [],
    items: makeItems(s.code, raw),
  }
}

export function normalizeGymnasium(s: ApiSubject): SnapshotSubject {
  const raw: Omit<SnapshotItem, 'id'>[] = purposeGoals(s.purpose ?? '').map((text) => ({ kind: 'goal', text }))
  for (const c of s.courses ?? []) {
    for (const b of parseContentBlocks(c.centralContent?.text ?? ''))
      raw.push({ kind: 'central_content', span: c.code, ...b })
    for (const kr of c.knowledgeRequirements ?? []) {
      const r = parseRequirement(kr.text)
      if (r.text) raw.push({ kind: 'knowledge_requirement', span: c.code, gradeStep: kr.gradeStep, ...r })
    }
  }
  for (const kr of s.knowledgeRequirements ?? []) {
    const r = parseRequirement(kr.text)
    if (r.text) raw.push({ kind: 'knowledge_requirement', gradeStep: kr.gradeStep, ...r })
  }
  return {
    ...common(s),
    stage: 'gymnasieskola',
    applicableYears: [1, 2, 3],
    courses: (s.courses ?? []).map((c) => ({ code: c.code, name: c.name, points: c.points })),
    items: makeItems(s.code, raw),
  }
}

function common(s: ApiSubject) {
  return {
    code: s.code,
    name: s.name,
    syllabusType: s.typeOfSyllabus,
    reform: s.reform,
    categories: (s.categories ?? []).map((c) => c.code),
    schoolTypes: s.schoolTypes,
    validFrom: s.startDate,
    validUntil: s.endDate,
    sourceVersion: s.version,
    purpose: htmlToText(s.purpose ?? ''),
    sourceUrl: subjectUrl(s.code),
  }
}

/** Lgr22 chapter 3 (förskoleklass): no subject syllabus, but its own syfte and centralt innehåll. */
export function normalizeForskoleklass(sections: { type: string; content: string }[], url: string): SnapshotSubject {
  const fk = sections.find((s) => s.type === '3' && /Förskoleklass/i.test(s.content))
  if (!fk) throw new Error('Lgr22 förskoleklass chapter not found')
  const [syfteHtml = '', centralHtml = ''] = fk.content.split(/<h3>\s*Centralt innehåll\s*<\/h3>/i)
  const purposeHtml = syfteHtml.split(/<h3>\s*Syfte\s*<\/h3>/i)[1] ?? syfteHtml
  const raw: Omit<SnapshotItem, 'id'>[] = [
    ...purposeGoals(purposeHtml).map((text) => ({ kind: 'goal' as const, text })),
    ...parseContentBlocks(centralHtml).map((b) => ({ kind: 'central_content' as const, span: 'F', ...b })),
  ]
  return {
    code: FK_CODE,
    name: 'Förskoleklass',
    stage: 'forskoleklass',
    applicableYears: [0],
    syllabusType: 'CURRICULUM_CHAPTER',
    categories: [],
    schoolTypes: ['FKLASS'],
    purpose: htmlToText(purposeHtml),
    courses: [],
    sourceUrl: url,
    items: makeItems(FK_CODE, raw),
  }
}

// ---------- fetch ----------

async function getJson<T>(url: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { accept: 'application/json' } })
    if (res.ok) return (await res.json()) as T
    if (attempt >= 3) throw new Error(`${res.status} ${url}`)
    await new Promise((r) => setTimeout(r, 1000 * attempt))
  }
}

async function mapLimit<T, R>(xs: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  let i = 0
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < xs.length) {
        const k = i++
        out[k] = await fn(xs[k]!)
      }
    }),
  )
  return out
}

/** Gymnasium subjects included: everything except vocational (yrkesämnen), both GY11 and GY25. */
const includeGymnasium = (s: ApiSubject) => !(s.categories ?? []).some((c) => c.code === 'VOCATIONAL')

export async function fetchSnapshot(now = new Date()): Promise<CurriculumSnapshot> {
  const info = await getJson<{ apiVersion: string }>(`${API_BASE}/api-info`)
  const list = async (st: string) =>
    (await getJson<{ subjects: ApiSubject[] }>(`${API_BASE}/subjects?schooltype=${st}&timespan=LATEST`)).subjects
  const [gr, gy] = await Promise.all([list('GR'), list('GY')])
  const detail = (code: string) => getJson<{ subject: ApiSubject }>(subjectUrl(code)).then((r) => r.subject)

  const lgrUrl = `${API_BASE}/curriculums/LGR22`
  const lgr = await getJson<{ curriculum: { sections: { type: string; content: string }[] } }>(lgrUrl)
  const grSubjects = await mapLimit(gr, 4, (s) => detail(s.code).then(normalizeGrundskola))
  const gySubjects = await mapLimit(gy.filter(includeGymnasium), 4, (s) => detail(s.code).then(normalizeGymnasium))

  return CurriculumSnapshot.parse({
    source: 'skolverket',
    version: now.toISOString().slice(0, 10),
    retrievedAt: now.toISOString(),
    apiVersion: info.apiVersion,
    licence: 'CC0 1.0 (Skolverkets öppna data)',
    sourceUrls: [
      `${API_BASE}/subjects?schooltype=GR&timespan=LATEST`,
      `${API_BASE}/subjects?schooltype=GY&timespan=LATEST`,
      `${API_BASE}/subjects/{code}`,
      lgrUrl,
    ],
    subjects: [normalizeForskoleklass(lgr.curriculum.sections, lgrUrl), ...grSubjects, ...gySubjects].filter(
      (s) => s.items.length > 0,
    ),
  })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const snap = await fetchSnapshot()
  mkdirSync(DATA_DIR, { recursive: true })
  const file = new URL(`skolverket-${snap.version}.json.gz`, DATA_DIR)
  writeFileSync(file, gzipSync(JSON.stringify(snap), { level: 9 }))
  const items = snap.subjects.reduce((n, s) => n + s.items.length, 0)
  console.log(`wrote ${file.pathname}: ${snap.subjects.length} subjects, ${items} items (API ${snap.apiVersion})`)
}
