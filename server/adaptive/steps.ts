import { and, asc, eq, lte } from 'drizzle-orm'
import {
  GenerationRequest,
  type CurriculumRef,
  type LearnerProfileInput,
  type SkillSummary,
} from '../../shared/contracts'
import { subjectsFor } from '../curriculum/service'
import type { Db } from '../db/client'
import { learningPaths, skillReviews } from '../db/schema'
import { requireLearner } from '../gate/guards'
import { loadObs, skillLabel, skillStates, type Obs, type Outcome, type SkillState } from './skills'

// Next steps, remediation requests and spaced review. See docs/platform/adaptive.md.

type Profile = LearnerProfileInput & { id: string }
const DAY = 86_400_000

const QUESTIONS = { low: 5, normal: 8, high: 12 } as const
const isMath = (skill: string) => skill.split('.')[0] === 'math'

/** Presentation hints for the generator; independent of academic difficulty. */
function supportLines(p: Profile): string[] {
  const s = p.support
  const out = [`Högst ${s.maxChoices} svarsalternativ per uppgift.`]
  if (s.textAmount === 'minimal') out.push('Mycket lite text: korta instruktioner, inga långa stycken.')
  if (s.textAmount === 'reduced') out.push('Korta texter.')
  if (s.visualSupport === 'high') out.push('Mycket bildstöd: visa med bilder eller konkreta föremål.')
  if (s.stepByStep) out.push('En sak i taget.')
  return out
}

/** Answer kinds that fit the skill and the learner's text preference. */
function kindsFor(skill: string, p: Profile): string[] {
  const kinds = isMath(skill) ? ['numeric', 'multipleChoice', 'matching'] : ['multipleChoice', 'matching', 'fillBlank']
  return p.support.textAmount === 'normal' ? kinds : [...kinds.filter((k) => k !== 'fillBlank'), 'trueFalse']
}

/**
 * Targeted lesson for a skill that needs support: easier representation → worked example →
 * guided practice → repeated practice → final check. Difficulty one step below recent work;
 * presentation follows the learner's support preferences unchanged.
 */
export function remediationRequest(
  summary: SkillSummary,
  profile: Profile,
  opts: { difficulty?: number; curriculumRefs?: CurriculumRef[]; studySetId?: string } = {},
): GenerationRequest {
  const label = skillLabel(summary.skill)
  return GenerationRequest.parse({
    learnerId: profile.id,
    type: 'lesson',
    subjectCode: summary.subjectCode,
    school: profile.school,
    topic: `Extra träning: ${label}`,
    curriculumRefs: opts.curriculumRefs ?? [],
    studySetId: opts.studySetId,
    questionCount: QUESTIONS[profile.support.repetition],
    itemKinds: kindsFor(summary.skill, profile),
    difficulty: Math.max(1, (opts.difficulty ?? 2) - 1),
    durationMinutes: profile.support.sessionMinutes,
    support: profile.support,
    feedback: 'immediate',
    hints: true,
    includeImages: profile.support.visualSupport === 'high',
    skills: [summary.skill],
    instructions: [
      `Stödlektion om ${label}, i den här ordningen:`,
      '1. En enklare representation (bild, konkret material eller tallinje).',
      '2. Ett genomarbetat exempel steg för steg.',
      '3. Guidad övning med ledtrådar.',
      '4. Upprepad övning på samma nivå.',
      '5. En kort avslutande kontroll (section kind "check").',
      ...supportLines(profile),
    ].join('\n'),
  })
}

/** Plain practice/revision draft for a skill set (review, path milestone, new subject). */
export function practiceRequest(
  profile: Profile,
  o: {
    type: 'revision' | 'exercises' | 'lesson'
    topic: string
    skills?: string[]
    subjectCode?: string
    difficulty?: number
    curriculumRefs?: CurriculumRef[]
    studySetId?: string
  },
): GenerationRequest {
  return GenerationRequest.parse({
    learnerId: profile.id,
    type: o.type,
    subjectCode: o.subjectCode,
    school: profile.school,
    topic: o.topic,
    curriculumRefs: o.curriculumRefs ?? [],
    studySetId: o.studySetId,
    questionCount: o.type === 'revision' ? QUESTIONS[profile.support.repetition] - 2 : undefined,
    difficulty: o.difficulty,
    durationMinutes: profile.support.sessionMinutes,
    support: profile.support,
    includeImages: profile.support.visualSupport === 'high',
    skills: o.skills,
    instructions: supportLines(profile).join('\n'),
  })
}

/** Median difficulty of the newest 10 live answers, if any. */
export function typicalDifficulty(obs: Obs[]): number | undefined {
  const d = obs
    .filter((o) => o.difficulty !== undefined)
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 10)
    .map((o) => o.difficulty!)
    .sort((a, b) => a - b)
  return d.length ? d[Math.floor(d.length / 2)] : undefined
}

// ---------- spaced review ----------

export const REVIEW_INTERVAL_DAYS = [1, 3, 7, 14, 30]

/** Any helped answer → back to the first interval; all first-try → next interval; otherwise stay. */
export function nextReviewStep(step: number, outcomes: Outcome[]): number {
  if (!outcomes.length) return step
  if (outcomes.includes('helped')) return 0
  if (outcomes.every((o) => o === 'first')) return Math.min(step + 1, REVIEW_INTERVAL_DAYS.length - 1)
  return step
}

export const dueAfter = (from: Date, step: number) => new Date(from.getTime() + REVIEW_INTERVAL_DAYS[step]! * DAY)

/** Start a review for newly secure leaf skills; reschedule existing ones from answers since the last update. */
export async function syncReviews(db: Db, learnerId: string, states: SkillState[]) {
  const existing = new Map(
    (await db.select().from(skillReviews).where(eq(skillReviews.learnerId, learnerId))).map((r) => [r.skill, r]),
  )
  for (const s of states) {
    if (!s.leaf) continue
    const live = s.obs.filter((o) => o.skill === s.skill && !o.legacy)
    const r = existing.get(s.skill)
    if (!r) {
      if (s.status !== 'secure' || !live.length) continue
      const last = new Date(Math.max(...live.map((o) => o.at.getTime())))
      await db
        .insert(skillReviews)
        .values({ learnerId, skill: s.skill, step: 0, dueAt: dueAfter(last, 0), updatedAt: last })
        .onConflictDoNothing()
      continue
    }
    const fresh = live.filter((o) => o.at > r.updatedAt).sort((a, b) => a.at.getTime() - b.at.getTime())
    if (!fresh.length) continue
    const last = fresh.at(-1)!.at
    const step = nextReviewStep(
      r.step,
      fresh.map((o) => o.outcome),
    )
    await db
      .update(skillReviews)
      .set({ step, dueAt: dueAfter(last, step), updatedAt: last })
      .where(and(eq(skillReviews.learnerId, learnerId), eq(skillReviews.skill, s.skill)))
  }
}

// ---------- next steps ----------

export type StepKind = 'remediate' | 'review' | 'continuePath' | 'explore'

export interface NextStep {
  kind: StepKind
  title: string
  /** Short Swedish reason for adults, with evidence counts. */
  reason: string
  /** Child-friendly line for learner mode. */
  childText: string
  skill?: string
  pathId?: string
  milestoneId?: string
  request: GenerationRequest
}

/**
 * Ranked: remediate (needsSupport) → due reviews → active path milestones → something new
 * from the curriculum for the learner's year. At most 2 per kind, 6 in total.
 */
export async function nextSteps(db: Db, learnerId: string, now = new Date()): Promise<NextStep[]> {
  const learner = await requireLearner(db, learnerId)
  const profile: Profile = { ...learner.profile, id: learner.id }
  const lo = await loadObs(db, learnerId)
  const states = skillStates(lo, now)
  const byskill = new Map(states.map((s) => [s.skill, s]))
  const steps: NextStep[] = []

  const support = states
    .filter((s) => s.leaf && s.status === 'needsSupport')
    .sort((a, b) => b.judgement.helped - a.judgement.helped || a.skill.localeCompare(b.skill))
    .slice(0, 2)
  for (const s of support)
    steps.push({
      kind: 'remediate',
      skill: s.skill,
      title: `Extra träning: ${skillLabel(s.skill)}`,
      reason: s.note!,
      childText: `Vi tränar lite extra på ${skillLabel(s.skill)}, steg för steg.`,
      request: remediationRequest(s, profile, { difficulty: typicalDifficulty(s.obs) }),
    })

  const due = await db
    .select()
    .from(skillReviews)
    .where(and(eq(skillReviews.learnerId, learnerId), lte(skillReviews.dueAt, now)))
    .orderBy(asc(skillReviews.dueAt))
  for (const r of due.filter((r) => !support.some((s) => s.skill === r.skill)).slice(0, 2)) {
    const s = byskill.get(r.skill)
    const days = Math.max(0, Math.round((now.getTime() - (s?.judgement.lastAt?.getTime() ?? now.getTime())) / DAY))
    steps.push({
      kind: 'review',
      skill: r.skill,
      title: `Repetera ${skillLabel(r.skill)}`,
      reason: `Dags för repetition: ${skillLabel(r.skill)} övades senast för ${days} dagar sedan.`,
      childText: `Dags att repetera ${skillLabel(r.skill)}!`,
      request: practiceRequest(profile, {
        type: 'revision',
        topic: `Repetition: ${skillLabel(r.skill)}`,
        skills: [r.skill],
        subjectCode: s?.subjectCode,
        difficulty: s && typicalDifficulty(s.obs),
      }),
    })
  }

  const paths = await db
    .select()
    .from(learningPaths)
    .where(and(eq(learningPaths.learnerId, learnerId), eq(learningPaths.status, 'active')))
    .orderBy(asc(learningPaths.createdAt))
  for (const p of paths.slice(0, 2)) {
    const m = p.milestones.find((x) => x.status === 'active')
    if (!m) continue
    const done = p.milestones.filter((x) => x.status === 'done').length
    steps.push({
      kind: 'continuePath',
      pathId: p.id,
      milestoneId: m.id,
      title: m.title,
      reason: `Pågående mål "${p.goal}": delmål ${done + 1} av ${p.milestones.length}.`,
      childText: `Fortsätt mot ditt mål: ${p.goal}`,
      request: practiceRequest(profile, {
        type: 'exercises',
        topic: m.title,
        skills: m.skills,
        subjectCode: p.subjectCode ?? undefined,
        curriculumRefs: m.curriculumRefs,
        studySetId: p.studySetId ?? undefined,
      }),
    })
  }

  const practised = new Set([
    ...lo.obs.flatMap((o) => (o.subjectCode ? [o.subjectCode] : [])),
    ...paths.flatMap((p) => (p.subjectCode ? [p.subjectCode] : [])),
  ])
  // Curriculum not loaded yet → simply no "try something new" step.
  const subjects = await subjectsFor(db, learner.profile.school).catch(() => [])
  const { stage, year } = learner.profile.school
  const yearText = stage === 'forskoleklass' ? 'förskoleklass' : `år ${year}`
  for (const sub of subjects.filter((s) => !practised.has(s.code)).slice(0, steps.length ? 1 : 2))
    steps.push({
      kind: 'explore',
      title: `Prova ${sub.name}`,
      reason: `Inget övat i ${sub.name} än, som ingår i ${yearText}.`,
      childText: `Testa något nytt i ${sub.name}!`,
      request: practiceRequest(profile, { type: 'exercises', topic: sub.name, subjectCode: sub.code }),
    })
  return steps.slice(0, 6)
}

/** Learner-mode view: no adult notes or prompt drafts. */
export const childSteps = (steps: NextStep[]) =>
  steps.map((s) => ({ kind: s.kind, title: s.title, text: s.childText, pathId: s.pathId }))
