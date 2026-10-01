import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { SubjectCode, type LearningPath } from '../../shared/contracts'
import { AiError, type AiServices, type TextGeneration } from '../ai'
import { suggestRefs } from '../curriculum/service'
import type { Db } from '../db/client'
import { jobs, learningPaths, skillReviews, type StoredMilestone } from '../db/schema'
import { requireLearner } from '../gate/guards'
import { promptProfile } from '../learners/profile'
import { defineJobHandler, enqueue, JobFailure } from '../jobs'
import { loadObs, MIN_ANSWERS, skillLabel, skillStates } from './skills'
import { practiceRequest, remediationRequest, syncReviews, typicalDifficulty } from './steps'

// Learning paths: AI-proposed milestones, checked deterministically; lazy content; adaptation from evidence.
// See docs/platform/adaptive.md.

type PathRow = typeof learningPaths.$inferSelect
type Learner = Awaited<ReturnType<typeof requireLearner>>

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** YYYY-MM-DD that exists in the calendar (Date.parse rolls 02-31 over). */
function realDate(d: string) {
  const t = new Date(`${d}T00:00:00Z`)
  return isoDate.safeParse(d).success && !Number.isNaN(t.getTime()) && t.toISOString().startsWith(d)
}

export const PathInput = z.object({
  goal: z.string().trim().min(1).max(300),
  subjectCode: SubjectCode.optional(),
  targetDate: z.string().refine(realDate, 'ogiltigt datum').optional(),
  studySetId: z.string().uuid().optional(),
})
export const PlanPathPayload = PathInput.extend({ learnerId: z.string().uuid() })
export type PlanPathPayload = z.infer<typeof PlanPathPayload>
// Not registered via registerJobPayload: the route validates input and the handler parses the payload.

/** What the model may return. Deterministic checks (`checkPlan`) run after schema parsing. */
export const PlanOutput = z.object({
  milestones: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        skills: z.array(z.string().max(120)).max(10),
        refIds: z.array(z.string()).max(6).default([]),
        by: z.string().optional(),
      }),
    )
    .min(1)
    .max(30),
})
export type PlanOutput = z.infer<typeof PlanOutput>

export const MAX_MILESTONES = 12
export const SKILL_TAG = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){1,5}$/
/** Answers since a milestone activated before persistent needsSupport inserts a remediation milestone. */
export const REMEDIATION_MIN_ANSWERS = 4

/** Count, skills, refs and dates. Returns Swedish issues; empty = valid. */
export function checkPlan(
  plan: PlanOutput,
  o: { allowedRefIds: Set<string>; today: string; targetDate?: string },
): string[] {
  const issues: string[] = []
  if (plan.milestones.length > MAX_MILESTONES) issues.push(`högst ${MAX_MILESTONES} delmål`)
  let prev = o.today
  plan.milestones.forEach((m, i) => {
    const n = `delmål ${i + 1}`
    if (!m.skills.length) issues.push(`${n} saknar färdigheter`)
    for (const s of m.skills) if (!SKILL_TAG.test(s)) issues.push(`${n}: ogiltig färdighetstagg "${s.slice(0, 40)}"`)
    for (const r of m.refIds) if (!o.allowedRefIds.has(r)) issues.push(`${n}: okänd läroplansreferens`)
    if (m.by !== undefined) {
      if (!realDate(m.by)) issues.push(`${n}: ogiltigt datum`)
      else if (m.by < prev) issues.push(`${n}: datum före föregående delmål eller idag`)
      else if (o.targetDate && m.by > o.targetDate) issues.push(`${n}: datum efter måldatum`)
      else prev = m.by
    }
  })
  return issues
}

// ---------- planning (job) ----------

const SYSTEM = [
  'Du planerar en studieväg för en elev i den svenska skolan.',
  'Dela målet i 2–8 delmål i en rimlig ordning, från grund till mål.',
  'Varje delmål: kort titel på svenska, 1–4 färdighetstaggar (gemener, punktseparerade, hierarkiska,',
  't.ex. "math.addition.tens-crossing"), refIds endast från listan över läroplansinnehåll,',
  'och valfritt datum "by" (ÅÅÅÅ-MM-DD) som inte ligger före idag eller efter måldatumet.',
  'Återanvänd elevens befintliga färdighetstaggar när de passar.',
].join('\n')

function toJobFailure(e: unknown): never {
  if (e instanceof AiError) throw new JobFailure(e.code, e.message, e.retryable)
  throw e
}

/** Plan a path with AI, validate it, store it and enqueue content for the first milestone only. */
export async function planPath(
  db: Db,
  ai: TextGeneration | undefined,
  input: PlanPathPayload,
  opts: { signal?: AbortSignal; now?: Date } = {},
): Promise<string> {
  const now = opts.now ?? new Date()
  const learner = await requireLearner(db, input.learnerId)
  if (!ai) throw new JobFailure('ai_unavailable', 'Textgenerering är inte aktiverad.', false)
  // ponytail: BM25 on the goal text only; pass a subject's full central content if plans miss refs.
  const candidates = await suggestRefs(db, {
    position: learner.profile.school,
    subjectCode: input.subjectCode,
    text: input.goal,
    limit: 20,
  }).catch(() => [])
  const refs = new Map(candidates.map((c) => [c.ref.itemId ?? '', c.ref]))
  refs.delete('')
  const known = skillStates(await loadObs(db, learner.id), now)
    .filter((s) => s.leaf)
    .map((s) => s.skill)
    .slice(0, 40)
  const today = now.toISOString().slice(0, 10)
  const user = [
    `Mål: ${input.goal}`,
    `Idag: ${today}`,
    input.targetDate ? `Måldatum: ${input.targetDate}` : 'Inget måldatum.',
    promptProfile(learner.profile),
    `Befintliga färdighetstaggar: ${known.join(', ') || 'inga'}`,
    'Läroplansinnehåll (id | text):',
    ...candidates.filter((c) => c.ref.itemId).map((c) => `${c.ref.itemId} | ${c.text}`),
  ].join('\n')

  const res = await ai
    .generate({
      system: SYSTEM,
      messages: [{ role: 'user', content: user }],
      schema: PlanOutput,
      schemaName: 'learning_path',
      signal: opts.signal,
    })
    .catch(toJobFailure)
  const plan = res.output
  const issues = checkPlan(plan, { allowedRefIds: new Set(refs.keys()), today, targetDate: input.targetDate })
  if (issues.length)
    throw new JobFailure('ai_invalid_output', `AI-planen underkändes: ${issues.slice(0, 3).join('; ')}.`, false)

  const milestones: StoredMilestone[] = plan.milestones.map((m, i) => ({
    id: `m${i + 1}`,
    title: m.title,
    skills: [...new Set(m.skills)],
    status: i === 0 ? 'active' : 'upcoming',
    kind: 'goal',
    curriculumRefs: m.refIds.map((r) => refs.get(r)!),
    by: m.by,
    activatedAt: i === 0 ? now.toISOString() : undefined,
  }))
  const [row] = await db
    .insert(learningPaths)
    .values({
      learnerId: learner.id,
      goal: input.goal,
      subjectCode: input.subjectCode,
      targetDate: input.targetDate,
      studySetId: input.studySetId,
      status: 'active',
      milestones,
      // JS-side timestamps (ms precision) so the optimistic check in onEvidence can compare them.
      createdAt: now,
      updatedAt: new Date(),
    })
    .returning()
  milestones[0]!.jobId = await enqueueMilestone(db, row!, milestones[0]!, learner)
  await db.update(learningPaths).set({ milestones, updatedAt: new Date() }).where(eq(learningPaths.id, row!.id))
  return row!.id
}

export const pathPlanHandler = (deps: { ai: AiServices }) =>
  defineJobHandler('path.plan', (job, tools) =>
    planPath(tools.db, deps.ai.text, PlanPathPayload.parse(job.payload), { signal: tools.signal }),
  )

/** Lazy content: one artifact.generate per milestone, enqueued only when it becomes active. */
async function enqueueMilestone(db: Db, path: PathRow, m: StoredMilestone, learner: Learner, difficulty?: number) {
  const profile = { ...learner.profile, id: learner.id }
  const base = { curriculumRefs: m.curriculumRefs, studySetId: path.studySetId ?? undefined }
  const request =
    m.kind === 'remediation'
      ? remediationRequest(
          { skill: m.skills[0]!, subjectCode: path.subjectCode ?? undefined, status: 'needsSupport', evidenceCount: 0 },
          profile,
          { ...base, difficulty },
        )
      : practiceRequest(profile, {
          ...base,
          type: 'lesson',
          topic: m.title,
          skills: m.skills,
          subjectCode: path.subjectCode ?? undefined,
        })
  const r = await enqueue(db, {
    type: 'artifact.generate',
    payload: { request },
    learnerId: learner.id,
    dedupeKey: `path:${path.id}:${m.id}`,
  })
  return r.id
}

// ---------- adaptation ----------

export interface PathChange {
  pathId: string
  kind: 'advanced' | 'completed' | 'remediation'
  milestoneId: string
}

/**
 * Cheap deterministic step after new evidence: reschedule reviews, advance milestones whose skills
 * are secure, insert a remediation milestone when needsSupport persists. Call after recordEvidence.
 */
export async function onEvidence(db: Db, learnerId: string, now = new Date()): Promise<PathChange[]> {
  const learner = await requireLearner(db, learnerId)
  const lo = await loadObs(db, learnerId)
  const states = skillStates(lo, now)
  const byskill = new Map(states.map((s) => [s.skill, s]))
  await syncReviews(db, learnerId, states)
  const status = (s: string) => byskill.get(s)?.status ?? 'new'
  const changes: PathChange[] = []

  const paths = await db
    .select()
    .from(learningPaths)
    .where(and(eq(learningPaths.learnerId, learnerId), eq(learningPaths.status, 'active')))
  for (const p of paths) {
    const ms = structuredClone(p.milestones)
    const i = ms.findIndex((m) => m.status === 'active')
    if (i < 0) continue
    const m = ms[i]!
    const since = (s: string) =>
      lo.obs.filter(
        (o) => !o.legacy && (o.skill === s || o.skill.startsWith(s + '.')) && o.at >= new Date(m.activatedAt ?? 0),
      ).length
    let activate: StoredMilestone | undefined
    let pathStatus = p.status
    const finished =
      m.kind === 'remediation'
        ? status(m.skills[0]!) !== 'needsSupport' && since(m.skills[0]!) >= MIN_ANSWERS
        : m.skills.every((s) => status(s) === 'secure')
    if (finished) {
      m.status = 'done'
      activate = ms.find((x) => x.status === 'upcoming')
      if (!activate) pathStatus = 'completed'
      changes.push({ pathId: p.id, kind: activate ? 'advanced' : 'completed', milestoneId: m.id })
    } else if (m.kind === 'goal' && ms.length < 30) {
      const weak = m.skills.find(
        (s) =>
          status(s) === 'needsSupport' &&
          since(s) >= REMEDIATION_MIN_ANSWERS &&
          !ms.some((x) => x.kind === 'remediation' && x.skills[0] === s),
      )
      if (weak) {
        activate = {
          id: `r${randomUUID().slice(0, 8)}`,
          title: `Extra träning: ${skillLabel(weak)}`,
          skills: [weak],
          status: 'upcoming',
          kind: 'remediation',
          curriculumRefs: m.curriculumRefs,
        }
        m.status = 'upcoming'
        ms.splice(i, 0, activate)
        changes.push({ pathId: p.id, kind: 'remediation', milestoneId: activate.id })
      }
    }
    if (!finished && !activate) continue
    if (activate) {
      activate.status = 'active'
      activate.activatedAt = now.toISOString()
      // dedupeKey makes a concurrent run reuse the same job.
      activate.jobId ??= await enqueueMilestone(
        db,
        p,
        activate,
        learner,
        typicalDifficulty(byskill.get(activate.skills[0]!)?.obs ?? []),
      )
    }
    // Optimistic: skip if another onEvidence updated this path meanwhile.
    await db
      .update(learningPaths)
      .set({ milestones: ms, status: pathStatus, updatedAt: new Date() })
      .where(and(eq(learningPaths.id, p.id), eq(learningPaths.updatedAt, p.updatedAt)))
  }
  return changes
}

// ---------- read model ----------

/** Contract view: artifact ids come from completed generation jobs, reviews from skill_reviews. */
export async function toLearningPaths(db: Db, rows: PathRow[]): Promise<LearningPath[]> {
  if (!rows.length) return []
  const jobIds = rows.flatMap((r) => r.milestones.flatMap((m) => (m.jobId ? [m.jobId] : [])))
  const done = jobIds.length
    ? await db
        .select({ id: jobs.id, resultId: jobs.resultId })
        .from(jobs)
        .where(and(inArray(jobs.id, jobIds), eq(jobs.state, 'completed')))
    : []
  const artifact = new Map(done.map((j) => [j.id, j.resultId]))
  const reviews = await db.select().from(skillReviews).where(eq(skillReviews.learnerId, rows[0]!.learnerId))
  const uuid = z.string().uuid()
  return rows.map((r) => {
    const skills = r.milestones.flatMap((m) => m.skills)
    const covers = (s: string) => skills.some((k) => s === k || s.startsWith(k + '.'))
    return {
      id: r.id,
      learnerId: r.learnerId,
      goal: r.goal,
      subjectCode: r.subjectCode ?? undefined,
      targetDate: r.targetDate ?? undefined,
      milestones: r.milestones.map((m) => {
        const a = m.jobId ? artifact.get(m.jobId) : undefined
        return {
          id: m.id,
          title: m.title,
          skills: m.skills,
          status: m.status,
          artifactIds: a && uuid.safeParse(a).success ? [a] : [],
        }
      }),
      reviews: reviews.filter((v) => covers(v.skill)).map((v) => ({ skill: v.skill, dueAt: v.dueAt.toISOString() })),
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    }
  })
}
