import { z } from 'zod'
import { CapabilityStatus } from './ai'

// HTTP API conventions: JSON under /api/v1, errors as ApiError, auth via an httpOnly session cookie.

export const API_PREFIX = '/api/v1'

export const ApiError = z.object({
  error: z.object({
    /** Stable machine code, e.g. "unauthenticated", "forbidden", "not_found", "invalid_request", "limit_exceeded", "ai_unavailable". */
    code: z.string(),
    /** Safe Swedish message for display. */
    message: z.string(),
  }),
})
export type ApiError = z.infer<typeof ApiError>

/**
 * A session is always an authenticated adult. "Learner mode" is that adult handing the device to a
 * learner: the session then acts for one learner with learner-level permissions until an adult
 * re-authenticates (or unlocks with the device PIN) to leave it.
 */
export const SessionMode = z.enum(['adult', 'learner'])
export type SessionMode = z.infer<typeof SessionMode>

export const Me = z.object({
  user: z.object({ id: z.string().uuid(), displayName: z.string(), email: z.string().optional() }),
  mode: SessionMode,
  activeLearnerId: z.string().uuid().optional(),
})
export type Me = z.infer<typeof Me>

/** GET /api/v1/system/status — human-friendly availability for adults (no technical details). */
export const SystemStatus = z.object({
  ready: z.boolean(),
  capabilities: z.array(CapabilityStatus),
  features: z.object({ webResearch: z.boolean(), externalAssets: z.boolean(), imageGeneration: z.boolean() }),
  limits: z.object({ maxUploadFileMb: z.number(), maxUploadTotalMb: z.number(), maxPagesPerSet: z.number() }),
})
export type SystemStatus = z.infer<typeof SystemStatus>
