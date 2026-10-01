import { and, eq, ne, sql } from 'drizzle-orm'
import type { SkillStatus, SkillSummary } from '../../shared/contracts'
import type { Db } from '../db/client'
import { adaptiveLegacySkills, legacySkillProgress, skillEvidence, skillEvidenceKinds } from '../db/schema'

// Deterministic skill model: per-answer outcomes → recency-weighted window → status.
// Rules and thresholds: docs/platform/adaptive.md.

export type Outcome = 'first' | 'retry' | 'helped'

/** One answer as the rules see it. Legacy outcomes carry no difficulty/hints/kind. */
export interface Obs {
  skill: string
  subjectCode?: string
  outcome: Outcome
  at: Date
  difficulty?: number
  hintsUsed: number
  kind?: string
  legacy?: boolean
}

export const WINDOW = 10
export const MIN_ANSWERS = 3
export const SECURE_MIN_ANSWERS = 5
const DAY = 86_400_000

/** first = right at once without hints; helped = wrong/revealed, ≥2 misses or ≥2 hints; else retry. */
export function outcomeOf(e: { correct: boolean; misses: number; hintsUsed: number }): Outcome {
  if (!e.correct || e.misses >= 2 || e.hintsUsed >= 2) return 'helped'
  return e.misses === 0 && e.hintsUsed === 0 ? 'first' : 'retry'
}

/** Integer recency weight: last 14 days 4, last 60 days 2, older 1. */
export function weightOf(at: Date, now: Date): number {
  const days = (now.getTime() - at.getTime()) / DAY
  return days <= 14 ? 4 : days <= 60 ? 2 : 1
}

export interface Judgement {
  status: SkillStatus
  answers: number
  firstTry: number
  helped: number
  lastAt?: Date
}

/** Status from the newest WINDOW answers. `obs` may be in any order. */
export function judge(obs: Obs[], now: Date): Judgement {
  const win = [...obs].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, WINDOW)
  const count = (o: Outcome) => win.filter((x) => x.outcome === o).length
  const w = (o?: Outcome) => win.reduce((n, x) => n + (!o || x.outcome === o ? weightOf(x.at, now) : 0), 0)
  const j = { answers: win.length, firstTry: count('first'), helped: count('helped'), lastAt: win[0]?.at }
  const total = w()
  let status: SkillStatus = 'practising'
  if (win.length < MIN_ANSWERS) status = 'new'
  else if (j.helped >= 2 && w('helped') * 3 >= total) status = 'needsSupport'
  else if (win.length >= SECURE_MIN_ANSWERS && w('first') * 4 >= total * 3 && win[0]!.outcome !== 'helped')
    status = 'secure'
  return { ...j, status }
}

// ---------- labels and notes ----------

const LABELS: Record<string, string> = {
  math: 'matematik',
  swedish: 'svenska',
  english: 'engelska',
  addition: 'addition',
  subtraction: 'subtraktion',
  multiplication: 'multiplikation',
  division: 'division',
  'tens-crossing': 'tiotalsövergångar',
  counting: 'att räkna',
  comparison: 'att jämföra',
  reading: 'läsning',
  'word-recognition': 'ordläsning',
  comprehension: 'läsförståelse',
  letters: 'bokstäver',
  spelling: 'stavning',
  vocabulary: 'ord',
  patterns: 'mönster',
}

/** Swedish label of a skill tag's last segment (falls back to the segment itself). */
export function skillLabel(skill: string): string {
  const last = skill.split('.').at(-1)!
  return LABELS[last] ?? last.replace(/-/g, ' ')
}

export function noteFor(skill: string, j: Judgement): string {
  const label = skillLabel(skill)
  switch (j.status) {
    case 'new':
      return `För lite underlag om ${label} än (${j.answers} svar).`
    case 'needsSupport':
      return `Verkar behöva mer träning på ${label} (${j.answers} svar, ${j.helped} med hjälp).`
    case 'secure':
      return `Verkar säker på ${label} (${j.answers} svar, ${j.firstTry} rätt direkt).`
    default:
      return `Övar på ${label} (${j.answers} svar, ${j.firstTry} rätt direkt).`
  }
}

// ---------- legacy conversion ----------

/** Old first-grade SkillIds → hierarchical tags. Unknown ids become `legacy.<id>`. */
export const LEGACY_SKILL_MAP: Record<string, string> = {
  'read.letters': 'swedish.reading.letters',
  'read.words': 'swedish.reading.word-recognition',
  'read.missingLetter': 'swedish.spelling.missing-letter',
  'read.sentences': 'swedish.reading.comprehension',
  'math.count': 'math.counting',
  'math.compare': 'math.comparison',
  'math.oneMoreLess': 'math.number-sense.one-more-less',
  'math.sequence': 'math.number-sense.sequences',
  'math.add': 'math.addition',
  'math.sub': 'math.subtraction',
  'logic.pattern': 'math.patterns',
  'logic.order': 'math.patterns.ordering',
  'logic.category': 'math.patterns.categories',
  'air.recognize': 'science.technology.aircraft',
  'air.read': 'swedish.reading.word-recognition.aviation',
  'air.numbers': 'math.numbers.aviation',
  'air.compare': 'math.comparison.aviation',
  'en.words': 'english.vocabulary.words',
  'en.colors': 'english.vocabulary.colors',
  'en.numbers': 'english.vocabulary.numbers',
  'en.adjectives': 'english.vocabulary.adjectives',
  'en.listen': 'english.listening',
  'en.sentences': 'english.sentences',
}

export const mapLegacySkill = (s: string) => LEGACY_SKILL_MAP[s] ?? `legacy.${s.replace(/[^a-zA-Z0-9-]/g, '-')}`

/** Convert legacy_skill_progress once per import (re-runs are no-ops; a newer import replaces rows). */
export async function convertLegacy(db: Db, learnerId: string): Promise<number> {
  const rows = await db
    .select({ p: legacySkillProgress })
    .from(legacySkillProgress)
    .leftJoin(
      adaptiveLegacySkills,
      and(
        eq(adaptiveLegacySkills.learnerId, legacySkillProgress.learnerId),
        eq(adaptiveLegacySkills.legacySkill, legacySkillProgress.skill),
      ),
    )
    .where(
      and(
        eq(legacySkillProgress.learnerId, learnerId),
        sql`(${adaptiveLegacySkills.importId} is null or ${adaptiveLegacySkills.importId} <> ${legacySkillProgress.importId})`,
      ),
    )
  for (const { p } of rows) {
    const set = {
      skill: mapLegacySkill(p.skill),
      importId: p.importId,
      outcomes: p.recent,
      attempts: p.attempts,
      lastPracticedAt: p.lastPracticedAt,
    }
    await db
      .insert(adaptiveLegacySkills)
      .values({ learnerId, legacySkill: p.skill, ...set })
      .onConflictDoUpdate({
        target: [adaptiveLegacySkills.learnerId, adaptiveLegacySkills.legacySkill],
        set,
        setWhere: ne(adaptiveLegacySkills.importId, p.importId),
      })
  }
  return rows.length
}

// ---------- loading ----------

export interface LearnerObs {
  obs: Obs[]
  /** Legacy attempts beyond the kept outcomes, per mapped skill (counted, not judged). */
  extraCounts: Map<string, number>
}

export async function loadObs(db: Db, learnerId: string): Promise<LearnerObs> {
  await convertLegacy(db, learnerId)
  const live = await db
    .select({ e: skillEvidence, kind: skillEvidenceKinds.itemKind })
    .from(skillEvidence)
    .leftJoin(skillEvidenceKinds, eq(skillEvidenceKinds.evidenceId, skillEvidence.id))
    .where(eq(skillEvidence.learnerId, learnerId))
  const obs: Obs[] = live.map(({ e, kind }) => ({
    skill: e.skill,
    subjectCode: e.subjectCode ?? undefined,
    outcome: outcomeOf(e),
    at: e.at,
    difficulty: e.difficulty,
    hintsUsed: e.hintsUsed,
    kind: kind ?? undefined,
  }))
  const extraCounts = new Map<string, number>()
  const legacy = await db.select().from(adaptiveLegacySkills).where(eq(adaptiveLegacySkills.learnerId, learnerId))
  for (const l of legacy) {
    const at = l.lastPracticedAt ?? new Date(0)
    const kept = l.outcomes.filter((o): o is Outcome => o === 'first' || o === 'retry' || o === 'helped')
    // Same timestamp for all kept outcomes; offset by ms so "newest last" survives sorting.
    kept.forEach((outcome, i) =>
      obs.push({
        skill: l.skill,
        outcome,
        at: new Date(at.getTime() - (kept.length - 1 - i)),
        hintsUsed: 0,
        legacy: true,
      }),
    )
    extraCounts.set(l.skill, (extraCounts.get(l.skill) ?? 0) + Math.max(0, l.attempts - kept.length))
  }
  return { obs, extraCounts }
}

// ---------- summaries with roll-up ----------

/** `a.b.c` → [`a`, `a.b`, `a.b.c`]. */
export const prefixes = (skill: string) => skill.split('.').map((_, i, s) => s.slice(0, i + 1).join('.'))

export interface SkillState extends SkillSummary {
  judgement: Judgement
  /** True if the tag occurs directly in evidence (not only as a roll-up parent). */
  leaf: boolean
  obs: Obs[]
}

/** Every tag and all its parents; a parent pools the answers of all its descendants. */
export function skillStates({ obs, extraCounts }: LearnerObs, now: Date): SkillState[] {
  const buckets = new Map<string, Obs[]>()
  const leaves = new Set(obs.map((o) => o.skill))
  for (const s of extraCounts.keys()) leaves.add(s)
  for (const s of leaves) for (const p of prefixes(s)) if (!buckets.has(p)) buckets.set(p, [])
  for (const o of obs) for (const p of prefixes(o.skill)) buckets.get(p)!.push(o)
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([skill, list]) => {
      const judgement = judge(list, now)
      let extra = 0
      for (const [s, n] of extraCounts) if (s === skill || s.startsWith(skill + '.')) extra += n
      const subjectCode = list.find((o) => o.subjectCode)?.subjectCode
      return {
        skill,
        subjectCode,
        status: judgement.status,
        evidenceCount: list.length + extra,
        note: noteFor(skill, judgement),
        lastPracticedAt:
          judgement.lastAt && judgement.lastAt.getTime() > 0 ? judgement.lastAt.toISOString() : undefined,
        judgement,
        leaf: leaves.has(skill),
        obs: list,
      }
    })
}

const toSummary = ({ judgement: _j, leaf: _l, obs: _o, ...s }: SkillState): SkillSummary =>
  Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) as SkillSummary

export async function summarizeSkills(db: Db, learnerId: string, now = new Date()): Promise<SkillSummary[]> {
  return skillStates(await loadObs(db, learnerId), now).map(toSummary)
}

// ---------- pattern detectors ----------

export type PatternCode =
  'wordRecognitionOverComprehension' | 'recallOverExplanation' | 'hintsOverused' | 'harderItemsFail'

export interface Pattern {
  code: PatternCode
  skill?: string
  /** Swedish, qualitative, with evidence counts. */
  note: string
}

const RECALL_KINDS = new Set([
  'multipleChoice',
  'multiSelect',
  'trueFalse',
  'fillBlank',
  'matching',
  'ordering',
  'numeric',
  'flashcard',
])
const newest = (obs: Obs[], n: number) => [...obs].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, n)
const nFirst = (obs: Obs[]) => obs.filter((o) => o.outcome === 'first').length
const nHelped = (obs: Obs[]) => obs.filter((o) => o.outcome === 'helped').length

/** All four detectors. Each is deterministic; thresholds in docs/platform/adaptive.md. */
export function detectPatterns(states: SkillState[]): Pattern[] {
  const out: Pattern[] = []
  const last = (s: string) => s.split('.').at(-1)!

  // 1. Word recognition secure while comprehension (same parent) needs support.
  for (const word of states.filter((s) => last(s.skill) === 'word-recognition' && s.status === 'secure')) {
    const parent = word.skill.split('.').slice(0, -1).join('.')
    const comp = states.find((s) => s.skill === `${parent}.comprehension` && s.status === 'needsSupport')
    if (comp)
      out.push({
        code: 'wordRecognitionOverComprehension',
        skill: comp.skill,
        note:
          `Ordläsningen går bra (${word.judgement.answers} svar, ${word.judgement.firstTry} rätt direkt) ` +
          `men läsförståelsen behöver mer stöd (${comp.judgement.answers} svar, ${comp.judgement.helped} med hjälp).`,
      })
  }

  const live = states.flatMap((s) => (s.skill.includes('.') ? [] : [s])) // roots
  for (const root of live) {
    const obs = root.obs.filter((o) => !o.legacy)

    // 2. Recall items right while free-text explanations struggle.
    const recall = newest(
      obs.filter((o) => o.kind && RECALL_KINDS.has(o.kind)),
      20,
    )
    const explain = newest(
      obs.filter((o) => o.kind === 'freeText'),
      10,
    )
    if (
      recall.length >= 5 &&
      nFirst(recall) * 4 >= recall.length * 3 &&
      explain.length >= 3 &&
      nHelped(explain) * 2 >= explain.length
    )
      out.push({
        code: 'recallOverExplanation',
        skill: root.skill,
        note:
          `Faktafrågor i ${skillLabel(root.skill)} går bra (${nFirst(recall)} av ${recall.length} rätt direkt) ` +
          `men förklarande svar behöver stöd (${nHelped(explain)} av ${explain.length} med hjälp).`,
      })

    // 4. Errors concentrated at higher difficulty.
    const recent = newest(obs, 30)
    const hard = recent.filter((o) => (o.difficulty ?? 0) >= 4)
    const easy = recent.filter((o) => o.difficulty !== undefined && o.difficulty <= 3)
    if (hard.length >= 3 && nHelped(hard) * 2 >= hard.length && easy.length >= 3 && nHelped(easy) * 4 <= easy.length)
      out.push({
        code: 'harderItemsFail',
        skill: root.skill,
        note:
          `I ${skillLabel(root.skill)} går lättare uppgifter bra (${easy.length - nHelped(easy)} av ${easy.length} utan hjälp) ` +
          `men svårare uppgifter behöver stöd (${nHelped(hard)} av ${hard.length} med hjälp).`,
      })
  }

  // 3. Hints overused: hints in at least half of the newest 20 answers.
  const all = newest(
    states.filter((s) => s.leaf).flatMap((s) => s.obs.filter((o) => o.skill === s.skill && !o.legacy)),
    20,
  )
  const hinted = all.filter((o) => o.hintsUsed > 0).length
  if (all.length >= 6 && hinted * 2 >= all.length)
    out.push({
      code: 'hintsOverused',
      note: `Använder ledtrådar ofta (${hinted} av ${all.length} senaste svar). Uppmuntra att försöka själv först.`,
    })
  return out
}
