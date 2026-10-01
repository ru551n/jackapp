import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { RouteModule } from '../app/context'
import { learningPaths } from '../db/schema'
import { HttpError, requireAdult, requireLearner } from '../gate/guards'
import { enqueue } from '../jobs'
import { PathInput, toLearningPaths } from './paths'
import { detectPatterns, loadObs, skillStates, summarizeSkills } from './skills'
import { childSteps, nextSteps } from './steps'

const Params = z.object({ id: z.string().uuid() })
const PathParams = Params.extend({ pathId: z.string().uuid() })
const notFound = () => new HttpError(404, 'not_found', 'Hittades inte.')

export const adaptiveRoutes: RouteModule = (app, { db }) => {
  async function loadPath(params: unknown) {
    const { id, pathId } = PathParams.parse(params)
    await requireLearner(db, id)
    const [p] = await db
      .select()
      .from(learningPaths)
      .where(and(eq(learningPaths.id, pathId), eq(learningPaths.learnerId, id)))
    if (!p) throw notFound()
    return p
  }

  /** Skill summaries and detected patterns (adult). */
  app.get('/learners/:id/skills', async (req) => {
    requireAdult(req)
    const l = await requireLearner(db, Params.parse(req.params).id)
    const skills = await summarizeSkills(db, l.id)
    const patterns = detectPatterns(skillStates(await loadObs(db, l.id), new Date()))
    return { skills, patterns }
  })

  /** Ranked next steps; learner mode gets a child-friendly view without notes or request drafts. */
  app.get('/learners/:id/next', async (req) => {
    const l = await requireLearner(db, Params.parse(req.params).id)
    const steps = await nextSteps(db, l.id)
    return req.gate?.adult ? steps : childSteps(steps)
  })

  /** Plan a path (job `path.plan`; resultId = path id). Adult, or the learner if the profile allows requests. */
  app.post('/learners/:id/paths', async (req, reply) => {
    const l = await requireLearner(db, Params.parse(req.params).id)
    if (!req.gate?.adult && !l.profile.generation.learnerRequestsAllowed) requireAdult(req)
    const input = PathInput.parse(req.body)
    const job = await enqueue(db, { type: 'path.plan', payload: { ...input, learnerId: l.id }, learnerId: l.id })
    return reply.status(202).send({ jobId: job.id })
  })

  app.get('/learners/:id/paths', async (req) => {
    const l = await requireLearner(db, Params.parse(req.params).id)
    const rows = await db
      .select()
      .from(learningPaths)
      .where(eq(learningPaths.learnerId, l.id))
      .orderBy(desc(learningPaths.createdAt))
    return toLearningPaths(db, rows)
  })

  app.get('/learners/:id/paths/:pathId', async (req) => (await toLearningPaths(db, [await loadPath(req.params)]))[0])

  for (const [action, from, to] of [
    ['pause', 'active', 'paused'],
    ['resume', 'paused', 'active'],
  ] as const)
    app.post(`/learners/:id/paths/:pathId/${action}`, async (req) => {
      requireAdult(req)
      const p = await loadPath(req.params)
      if (p.status !== from) throw new HttpError(409, 'invalid_state', 'Studievägen kan inte ändras så just nu.')
      const [row] = await db
        .update(learningPaths)
        .set({ status: to, updatedAt: new Date() })
        .where(eq(learningPaths.id, p.id))
        .returning()
      return (await toLearningPaths(db, [row!]))[0]
    })

  app.delete('/learners/:id/paths/:pathId', async (req, reply) => {
    requireAdult(req)
    const p = await loadPath(req.params)
    await db.delete(learningPaths).where(eq(learningPaths.id, p.id))
    return reply.status(204).send()
  })
}
