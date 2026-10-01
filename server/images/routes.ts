import { z } from 'zod'
import { ageBand } from '../../shared/contracts'
import type { RouteModule } from '../app/context'
import { HttpError, requireAdult, requireLearner } from '../gate/guards'
import { jobsServices } from '../jobs'
import { ImageJobPayload, ImagePurpose, imageStatus, imageUnavailable, MediaPath, screenRequest } from './index'

const Params = z.object({ id: z.string().uuid() })

const Body = z.object({
  purpose: ImagePurpose.default('illustration'),
  description: z.string().min(1).max(280),
  subject: z.string().max(100).default(''),
  count: z.number().int().min(1).max(20).optional(),
  allowText: z.boolean().default(false),
  /** Defaults to the learner's first theme or interest. */
  theme: z.string().max(60).optional(),
  artifactId: z.string().uuid().optional(),
  target: z.object({ path: MediaPath }).optional(),
})

/**
 * POST /learners/:id/images (adult): request an illustration → 202 { jobId }; the job result is the asset id.
 * GET /images/limits (adult): today's count, cap and whether generation is enabled.
 */
export const imageRoutes: RouteModule = (app, ctx) => {
  app.get('/images/limits', async (req) => {
    requireAdult(req)
    return imageStatus(ctx.db, ctx.ai)
  })

  app.post('/learners/:id/images', async (req, reply) => {
    requireAdult(req)
    const learner = await requireLearner(ctx.db, Params.parse(req.params).id)
    const b = Body.parse(req.body)
    const { profile } = learner
    const payload = ImageJobPayload.parse({
      ...b,
      style: { ageBand: ageBand(profile.school), theme: b.theme ?? profile.themes[0] ?? profile.interests[0] },
      learnerId: learner.id,
    })
    const off = imageUnavailable(ctx.ai)
    if (off) throw new HttpError(409, off.code, off.message)
    const refused = screenRequest(payload)
    if (refused) throw new HttpError(422, refused.code, refused.message)
    const status = await imageStatus(ctx.db, ctx.ai)
    if (status.remaining === 0) throw new HttpError(429, 'limit_exceeded', status.label)
    const jobs = ctx.jobs ?? jobsServices(ctx)
    const { id } = await jobs.enqueue({ type: 'image.generate', payload, learnerId: learner.id })
    return reply.status(202).send({ jobId: id })
  })
}
