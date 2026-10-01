import type { FastifyReply, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import type { Db } from '../db/client'
import { learners } from '../db/schema'

// JackApp has no authentication: whoever reaches it is trusted (the proxy decides that).
// The only distinction is the *adult gate*: a household PIN that keeps children out of adult
// screens and adult-only API routes on a shared device. It is a UX guard, not security.

export class HttpError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Adult-only routes (profiles, settings, approvals, generation management). */
export function requireAdult(req: FastifyRequest): void {
  if (!req.gate?.adult) throw new HttpError(403, 'adult_required', 'Det här kräver en vuxen.')
}

/** Load a learner or 404. Every learner belongs to the household. */
export async function requireLearner(db: Db, learnerId: string) {
  const [l] = await db.select().from(learners).where(eq(learners.id, learnerId))
  if (!l) throw new HttpError(404, 'not_found', 'Hittades inte.')
  return l
}

export function sendError(reply: FastifyReply, err: HttpError) {
  return reply.status(err.status).send({ error: { code: err.code, message: err.message } })
}
