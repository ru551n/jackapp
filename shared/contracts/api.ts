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
 * JackApp has no accounts or login (access is controlled by the reverse proxy). The only
 * distinction is the adult gate: a household PIN unlocking adult screens for a limited time.
 */
export const GateState = z.object({
  /** True when the household has set an adult PIN. */
  pinSet: z.boolean(),
  /** True while this device is unlocked for adult use. */
  adult: z.boolean(),
})
export type GateState = z.infer<typeof GateState>

/** GET /api/v1/system/status — human-friendly availability for adults (no technical details). */
export const SystemStatus = z.object({
  ready: z.boolean(),
  capabilities: z.array(CapabilityStatus),
  features: z.object({ webResearch: z.boolean(), externalAssets: z.boolean(), imageGeneration: z.boolean() }),
  limits: z.object({ maxUploadFileMb: z.number(), maxUploadTotalMb: z.number(), maxPagesPerSet: z.number() }),
})
export type SystemStatus = z.infer<typeof SystemStatus>
