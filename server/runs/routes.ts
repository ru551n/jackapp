import { and, desc, eq, type SQL } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'
import { ageBand, type AgeBand, type Artifact, type Item, type SkillEvidence } from '../../shared/contracts'
import { recordEvidence } from '../adaptive/evidence'
import { onEvidence } from '../adaptive/paths'
import type { AppContext, RouteModule } from '../app/context'
import type { Db } from '../db/client'
import { runAnswers, runs } from '../db/schema'
import { HttpError, requireAdult, requireLearner } from '../gate/guards'
import {
  AnswerByKind,
  HintRequest,
  StartRunRequest,
  SubmitAnswerRequest,
  type AnswerFeedback,
  type RunSummary,
  type RunView,
} from './api'
import { assessFreeText, checkAnswer, publicItem, solutionText, type FreeTextAssessment } from './check'

// Interactive runs: start, answer, hint, finish, abandon, adult history. Docs: docs/platform/runs.md

/** Injected by the orchestrator (server/generation owns artifacts). Latest version when `version` is omitted. */
export type ArtifactLoader = (db: Db, artifactId: string, version?: number) => Promise<Artifact | undefined>

declare module '../app/context' {
  interface AppContext {
    loadArtifactVersion?: ArtifactLoader
  }
}

/** Tries before the answer is revealed in immediate mode, per age band. */
export const REVEAL_AFTER: Record<AgeBand, number> = { early: 3, middle: 3, upper: 4 }

/** Calm learner-facing lines. Never "fel". */
export const MSG = {
  correct: 'Rätt! Bra jobbat.',
  partial: 'Nästan! Prova igen.',
  retry: 'Prova igen.',
  revealed: 'Här är svaret. Vi tittar på det tillsammans.',
  saved: 'Svaret är sparat.',
  rated: 'Bra att du tränar!',
  selfAssess: 'Jämför ditt svar med punkterna och bedöm själv.',
  notFinished: 'Här är svaret, så kan du titta på det igen.',
}

type Run = typeof runs.$inferSelect
type AnswerRow = typeof runAnswers.$inferSelect
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

const Params = z.object({ id: z.string().uuid() })
const RunParams = z.object({ id: z.string().uuid(), runId: z.string().uuid() })
const HistoryQuery = z.object({ artifactId: z.string().uuid().optional() })

const itemsOf = (a: Artifact) => a.sections.flatMap((s) => s.items)
const rated = (i: Item) => i.kind === 'flashcard' || i.kind === 'freeText'

function byItem(rows: AnswerRow[]) {
  const m = new Map<string, AnswerRow[]>()
  for (const r of [...rows].sort((a, b) => a.attempt - b.attempt)) m.set(r.itemId, [...(m.get(r.itemId) ?? []), r])
  return m
}

/** Full feedback for a settled item. */
function settled(item: Item, row: Pick<AnswerRow, 'attempt' | 'correct' | 'score'>, message: string, revealed = false) {
  return {
    itemId: item.id,
    attempt: row.attempt,
    correct: row.correct,
    score: row.score,
    message,
    done: true,
    revealed,
    solution: solutionText(item),
    explanation: item.explanation,
  } satisfies AnswerFeedback
}

function evidence(
  run: Run,
  art: Artifact,
  item: Item,
  correct: boolean,
  misses: number,
  hintsUsed: number,
): SkillEvidence[] {
  const at = new Date().toISOString()
  return item.skills.map((skill) => ({
    learnerId: run.learnerId,
    skill,
    subjectCode: art.subjectCode,
    artifactId: art.id,
    itemId: item.id,
    correct,
    misses,
    hintsUsed,
    difficulty: item.difficulty,
    at,
  }))
}

function summarize(run: Run, items: Item[], rows: AnswerRow[]): RunSummary {
  const g = byItem(rows)
  const last = (i: Item) => g.get(i.id)?.at(-1)
  const solved = (i: Item) => last(i)?.final === true && last(i)?.correct === true
  const answered = items.filter((i) => g.has(i.id))
  const correct = items.filter(solved).length
  const skills = [...new Set(answered.flatMap((i) => i.skills))].map((skill) => {
    const its = answered.filter((i) => i.skills.includes(skill))
    const ok = its.filter(solved).length
    const note =
      ok === its.length ? 'Det här sitter bra.' : ok * 2 >= its.length ? 'På god väg.' : 'Värt att öva lite mer på.'
    return { skill, correct: ok, total: its.length, note }
  })
  const pending = (i: Item) => last(i)?.correct === null
  const firstTry = (i: Item) => solved(i) && (run.feedback === 'end' || last(i)!.attempt === 1)
  return {
    answered: answered.length,
    total: items.length,
    correct,
    message: !answered.length
      ? 'Du kan fortsätta öva när du vill.'
      : `Du klarade ${correct} av ${items.length}. ${correct === items.length ? 'Fantastiskt!' : 'Bra kämpat!'}`,
    skills,
    review: items
      .filter((i) => !pending(i) && !firstTry(i))
      .map((i) => ({ itemId: i.id, prompt: i.prompt, solution: solutionText(i), explanation: i.explanation })),
    selfAssess: items.filter(pending).map((i) => {
      const it = i as Extract<Item, { kind: 'freeText' }>
      return {
        itemId: i.id,
        answer: (last(i)!.answer as { text: string }).text,
        rubric: it.rubric,
        sampleAnswer: it.sampleAnswer,
      }
    }),
  }
}

export const runRoutes: RouteModule = (app, ctx: AppContext) => {
  const { db } = ctx

  async function loadArtifact(artifactId: string, version?: number) {
    if (!ctx.loadArtifactVersion) throw new HttpError(503, 'not_configured', 'Övningar är inte tillgängliga just nu.')
    return ctx.loadArtifactVersion(db, artifactId, version)
  }

  async function loadRun(learnerId: string, runId: string) {
    const [run] = await db
      .select()
      .from(runs)
      .where(and(eq(runs.id, runId), eq(runs.learnerId, learnerId)))
    if (!run) throw new HttpError(404, 'not_found', 'Hittades inte.')
    const art = await loadArtifact(run.artifactId, run.artifactVersion)
    if (!art) throw new HttpError(404, 'not_found', 'Materialet finns inte längre.')
    return { run, art }
  }

  const lockRun = async (tx: Tx, runId: string) =>
    (await tx.select().from(runs).where(eq(runs.id, runId)).for('update'))[0]!
  const answersOf = (tx: Tx | Db, runId: string, ...conds: SQL[]) =>
    tx
      .select()
      .from(runAnswers)
      .where(and(eq(runAnswers.runId, runId), ...conds))

  async function view(run: Run, art: Artifact): Promise<RunView> {
    const g = byItem(await answersOf(db, run.id))
    const active = run.state === 'active'
    const items = itemsOf(art)
    return {
      id: run.id,
      learnerId: run.learnerId,
      artifactId: run.artifactId,
      artifactVersion: run.artifactVersion,
      title: art.title,
      mode: run.mode,
      feedback: run.feedback,
      state: run.state,
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      items: active ? items.map((i) => publicItem(i, run.id)) : items,
      progress: Object.fromEntries(
        items.map((i) => {
          const rows = g.get(i.id) ?? []
          const last = rows.at(-1)
          return [
            i.id,
            {
              attempts: rows.length,
              hintsShown: run.hintsShown[i.id] ?? 0,
              done: rows.some((r) => r.final),
              answer: last?.answer,
              feedback:
                last && (run.feedback === 'immediate' || !active) ? (last.feedback as AnswerFeedback) : undefined,
            },
          ]
        }),
      ),
      summary: (run.summary as RunSummary | null) ?? null,
    }
  }

  // After evidence was written: let adaptive paths/reviews react (best effort, never fails the answer).
  const wroteEvidence = new WeakSet<FastifyRequest>()
  app.addHook('onResponse', async (req, reply) => {
    if (reply.statusCode >= 400 || !wroteEvidence.has(req)) return
    const learnerId = (req.params as { id?: string }).id
    if (learnerId)
      await onEvidence(db, learnerId).catch((e: Error) => req.log.warn({ err: e.name }, 'adaptive update failed'))
  })

  /** Start, or resume the active run for this artifact. Learner mode: approved artifacts only. */
  app.post('/learners/:id/runs', async (req, reply) => {
    const { id } = Params.parse(req.params)
    await requireLearner(db, id)
    const { artifactId } = StartRunRequest.parse(req.body)
    const art = await loadArtifact(artifactId)
    if (!art || art.learnerId !== id) throw new HttpError(404, 'not_found', 'Hittades inte.')
    if (art.approval !== 'approved' && !req.gate?.adult)
      throw new HttpError(403, 'not_approved', 'Det här materialet behöver godkännas av en vuxen först.')
    if (!itemsOf(art).length) throw new HttpError(400, 'no_items', 'Det här materialet har inga uppgifter.')
    const [created] = await db
      .insert(runs)
      .values({
        learnerId: id,
        artifactId,
        artifactVersion: art.version,
        mode: art.type === 'practiceTest' ? 'test' : 'practice',
        feedback: art.feedback,
      })
      .onConflictDoNothing()
      .returning()
    if (created) return reply.status(201).send(await view(created, art))
    const [active] = await db
      .select()
      .from(runs)
      .where(and(eq(runs.learnerId, id), eq(runs.artifactId, artifactId), eq(runs.state, 'active')))
    const resumed = await loadRun(id, active!.id)
    return view(resumed.run, resumed.art)
  })

  app.get('/learners/:id/runs/:runId', async (req) => {
    const { id, runId } = RunParams.parse(req.params)
    await requireLearner(db, id)
    const { run, art } = await loadRun(id, runId)
    return view(run, art)
  })

  app.post('/learners/:id/runs/:runId/answers', async (req) => {
    const { id, runId } = RunParams.parse(req.params)
    const learner = await requireLearner(db, id)
    const body = SubmitAnswerRequest.parse(req.body)
    const { run: run0, art } = await loadRun(id, runId)
    const item = itemsOf(art).find((i) => i.id === body.itemId)
    if (!item) throw new HttpError(404, 'not_found', 'Uppgiften finns inte.')
    const answer = AnswerByKind[item.kind].parse(body.answer)
    const band = ageBand(learner.profile.school)
    const selfRating = item.kind === 'freeText' ? (answer as { selfRating?: string }).selfRating : undefined

    // Advisory AI assessment runs outside the transaction; its failure only means self-assessment.
    let assessment: FreeTextAssessment | undefined
    if (item.kind === 'freeText' && !selfRating && run0.state === 'active') {
      const [dup] = body.attempt
        ? await answersOf(db, runId, eq(runAnswers.itemId, item.id), eq(runAnswers.attempt, body.attempt))
        : []
      if (dup) return shown(run0, dup.feedback as AnswerFeedback)
      assessment = await assessFreeText(ctx.ai?.text, item, (answer as { text: string }).text, band)
    }

    return db.transaction(async (tx) => {
      const run = await lockRun(tx, runId)
      const rows = (await answersOf(tx, runId, eq(runAnswers.itemId, item.id))).sort((a, b) => a.attempt - b.attempt)
      const last = rows.at(-1)
      const resolving = !!selfRating && last?.correct === null
      if (body.attempt) {
        const prev = rows.find((r) => r.attempt === body.attempt)
        if (prev && !(resolving && prev === last)) return shown(run, prev.feedback as AnswerFeedback)
      }
      if (run.state !== 'active' && !resolving) throw new HttpError(409, 'run_closed', 'Den här omgången är avslutad.')
      if (rows.some((r) => r.final)) throw new HttpError(409, 'item_done', 'Den här uppgiften är redan klar.')
      const attempt = resolving ? last!.attempt : (last?.attempt ?? 0) + 1
      if (body.attempt && body.attempt > attempt)
        throw new HttpError(409, 'attempt_mismatch', 'Sidan behöver laddas om.')

      const pendingAi = item.kind === 'freeText' && !selfRating && !assessment
      const check = pendingAi
        ? null
        : assessment
          ? {
              score: assessment.score,
              correct: assessment.keyPointsMet.length === (item as { rubric: string[] }).rubric.length,
            }
          : checkAnswer(item, answer)
      const hints = { ...run.hintsShown }
      const hintsUsed = hints[item.id] ?? 0
      const base = { attempt, correct: check?.correct ?? null, score: check?.score ?? null }

      let fb: AnswerFeedback
      let final = false
      let revealed = false
      if (run.feedback === 'end' && run.state === 'active') {
        fb = { itemId: item.id, attempt, correct: null, score: null, message: MSG.saved, done: false, revealed: false }
        if (assessment) fb.ai = assessment // stored for finish/adults; hidden by shown()
      } else if (!check) {
        const it = item as Extract<Item, { kind: 'freeText' }>
        fb = {
          ...base,
          itemId: item.id,
          message: MSG.selfAssess,
          done: false,
          revealed: false,
          selfAssess: { rubric: it.rubric, sampleAnswer: it.sampleAnswer },
        }
      } else if (check.correct || rated(item)) {
        final = true
        fb = settled(item, base, assessment?.feedback ?? (rated(item) ? MSG.rated : MSG.correct))
        if (assessment) fb.ai = assessment
      } else if (attempt >= REVEAL_AFTER[band]) {
        final = revealed = true
        fb = settled(item, base, MSG.revealed, true)
      } else {
        const hint = item.hints[hintsUsed]
        if (hint) hints[item.id] = hintsUsed + 1
        fb = {
          ...base,
          itemId: item.id,
          message: check.score > 0 ? MSG.partial : MSG.retry,
          hint,
          done: false,
          revealed,
        }
      }

      const values = {
        answer,
        correct: base.correct,
        score: base.score,
        hintsShown: hintsUsed,
        revealed,
        final,
        aiAssessed: !!assessment,
        feedback: fb,
        at: new Date(),
      }
      if (resolving) await tx.update(runAnswers).set(values).where(eq(runAnswers.id, last!.id))
      else await tx.insert(runAnswers).values({ ...values, runId, itemId: item.id, attempt })
      if (hints[item.id] !== run.hintsShown[item.id])
        await tx.update(runs).set({ hintsShown: hints }).where(eq(runs.id, runId))
      if (final) {
        const misses = run.feedback === 'end' ? (check!.correct ? 0 : 1) : check!.correct ? attempt - 1 : attempt
        await recordEvidence(tx as unknown as Db, evidence(run, art, item, check!.correct, misses, hintsUsed))
        wroteEvidence.add(req)
      }
      // A post-finish self-assessment updates the stored summary.
      if (run.state !== 'active')
        await tx
          .update(runs)
          .set({ summary: summarize(run, itemsOf(art), await answersOf(tx, runId)) })
          .where(eq(runs.id, runId))
      return shown(run, fb)
    })
  })

  /** Next hint for an item (progressive). */
  app.post('/learners/:id/runs/:runId/hint', async (req) => {
    const { id, runId } = RunParams.parse(req.params)
    await requireLearner(db, id)
    const { itemId } = HintRequest.parse(req.body)
    const { art } = await loadRun(id, runId)
    const item = itemsOf(art).find((i) => i.id === itemId)
    if (!item) throw new HttpError(404, 'not_found', 'Uppgiften finns inte.')
    return db.transaction(async (tx) => {
      const run = await lockRun(tx, runId)
      if (run.state !== 'active') throw new HttpError(409, 'run_closed', 'Den här omgången är avslutad.')
      const n = run.hintsShown[itemId] ?? 0
      const hint = item.hints[n] ?? null
      const hintsShown = hint ? n + 1 : n
      if (hint)
        await tx
          .update(runs)
          .set({ hintsShown: { ...run.hintsShown, [itemId]: hintsShown } })
          .where(eq(runs.id, runId))
      return { hint, hintsShown, more: hintsShown < item.hints.length }
    })
  })

  /** Settle every attempted item, record evidence, store and return the summary. Idempotent. */
  app.post('/learners/:id/runs/:runId/finish', async (req) => {
    const { id, runId } = RunParams.parse(req.params)
    await requireLearner(db, id)
    const { art } = await loadRun(id, runId)
    return db.transaction(async (tx) => {
      const run = await lockRun(tx, runId)
      if (run.state === 'finished') return run.summary as RunSummary
      if (run.state === 'abandoned') throw new HttpError(409, 'run_closed', 'Den här omgången är avslutad.')
      const items = itemsOf(art)
      const g = byItem(await answersOf(tx, runId))
      const ev: SkillEvidence[] = []
      for (const item of items) {
        const rows = g.get(item.id)
        const last = rows?.at(-1)
        if (!last || last.final || last.correct === null) continue
        const end = run.feedback === 'end'
        const msg = end ? (last.correct ? MSG.correct : MSG.notFinished) : MSG.notFinished
        last.final = true
        last.feedback = { ...settled(item, last, msg), ai: (last.feedback as AnswerFeedback).ai }
        await tx.update(runAnswers).set({ final: true, feedback: last.feedback }).where(eq(runAnswers.id, last.id))
        const misses = end ? (last.correct ? 0 : 1) : last.attempt
        ev.push(...evidence(run, art, item, last.correct, misses, run.hintsShown[item.id] ?? 0))
      }
      await recordEvidence(tx as unknown as Db, ev)
      if (ev.length) wroteEvidence.add(req)
      const summary = summarize(run, items, [...g.values()].flat())
      await tx.update(runs).set({ state: 'finished', finishedAt: new Date(), summary }).where(eq(runs.id, runId))
      return summary
    })
  })

  /** Leave without penalty: answers stay, unsettled items record no evidence. */
  app.post('/learners/:id/runs/:runId/abandon', async (req) => {
    const { id, runId } = RunParams.parse(req.params)
    await requireLearner(db, id)
    await db
      .update(runs)
      .set({ state: 'abandoned', finishedAt: new Date() })
      .where(and(eq(runs.id, runId), eq(runs.learnerId, id), eq(runs.state, 'active')))
    const [run] = await db
      .select()
      .from(runs)
      .where(and(eq(runs.id, runId), eq(runs.learnerId, id)))
    if (!run) throw new HttpError(404, 'not_found', 'Hittades inte.')
    return { state: run.state }
  })

  /** Adult history with every attempt; AI assessments are marked as advisory. */
  app.get('/learners/:id/runs', async (req) => {
    requireAdult(req)
    const { id } = Params.parse(req.params)
    await requireLearner(db, id)
    const { artifactId } = HistoryQuery.parse(req.query)
    const list = await db
      .select()
      .from(runs)
      .where(and(eq(runs.learnerId, id), artifactId ? eq(runs.artifactId, artifactId) : undefined))
      .orderBy(desc(runs.startedAt))
    return Promise.all(
      list.map(async (r) => ({
        ...r,
        answers: (await answersOf(db, r.id))
          .sort((a, b) => a.itemId.localeCompare(b.itemId) || a.attempt - b.attempt)
          .map((a) => ({
            ...a,
            assessedBy: a.aiAssessed ? 'ai' : a.correct === null ? 'pending' : isSelf(a.answer) ? 'self' : 'auto',
          })),
      })),
    )
  })
}

/** End mode hides correctness and the AI assessment while the run is active. */
const shown = (run: Run, fb: AnswerFeedback): AnswerFeedback =>
  run.feedback === 'end' && run.state === 'active' && !fb.done ? { ...fb, ai: undefined } : fb

const isSelf = (a: unknown) =>
  typeof a === 'string' ? ['knew', 'partly', 'notYet'].includes(a) : !!(a as { selfRating?: string })?.selfRating
