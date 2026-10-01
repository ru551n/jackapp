import type { FastifyReply, FastifyRequest } from 'fastify'
import type { LearnerRole } from '../../shared/contracts'
import type { AuthInfo } from '../app/context'
import type { Db } from '../db/client'
import { roleFor } from './access'

// Server-side authorization helpers. Every route touching learner data must use these;
// hiding UI is never authorization.

export class HttpError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function requireAuth(req: FastifyRequest): AuthInfo {
  if (!req.auth) throw new HttpError(401, 'unauthenticated', 'Du behöver logga in.')
  return req.auth
}

/** Adult mode only (settings, approvals, profiles, sharing). */
export function requireAdult(req: FastifyRequest): AuthInfo {
  const auth = requireAuth(req)
  if (auth.mode !== 'adult') throw new HttpError(403, 'forbidden', 'Det här kräver en vuxen.')
  return auth
}

const RANK: Record<LearnerRole, number> = { viewer: 1, editor: 2, owner: 3 }

/**
 * Ensure the session may act for this learner. Adults need at least `min` role; a learner-mode
 * session may only act for its own active learner (and only for learner-level actions: pass
 * `allowLearnerMode`).
 */
export async function requireLearner(
  req: FastifyRequest,
  db: Db,
  learnerId: string,
  opts: { min?: LearnerRole; allowLearnerMode?: boolean } = {},
): Promise<AuthInfo> {
  const auth = requireAuth(req)
  const role = await roleFor(db, auth.userId, learnerId)
  if (!role) throw new HttpError(404, 'not_found', 'Hittades inte.') // do not reveal existence
  if (auth.mode === 'learner') {
    if (!opts.allowLearnerMode || auth.activeLearnerId !== learnerId)
      throw new HttpError(403, 'forbidden', 'Det här kräver en vuxen.')
    return auth
  }
  if (RANK[role] < RANK[opts.min ?? 'viewer']) throw new HttpError(403, 'forbidden', 'Du har inte behörighet.')
  return auth
}

export function sendError(reply: FastifyReply, err: HttpError) {
  return reply.status(err.status).send({ error: { code: err.code, message: err.message } })
}
