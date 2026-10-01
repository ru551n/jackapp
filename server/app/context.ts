import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import type { SessionMode } from '../../shared/contracts'
import type { CoreEnv } from '../config/env'
import type { Db } from '../db/client'

/** Result of one readiness probe. `detail` must be safe to show (no secrets/URLs with tokens). */
export interface ReadinessResult {
  ok: boolean
  detail?: string
}

export interface ReadinessCheck {
  name: string
  /** Critical checks gate /ready (database, migrations, required AI config, job queue). */
  critical: boolean
  check(): Promise<ReadinessResult>
}

/** Shared services for route modules. Modules may add typed services via declaration merging. */
export interface AppContext {
  env: CoreEnv
  db: Db
  log: FastifyBaseLogger
  readiness: ReadinessCheck[]
}

/** Authenticated principal, set by the auth/session plugin. */
export interface AuthInfo {
  userId: string
  mode: SessionMode
  /** Set in learner mode: the only learner this session may act for. */
  activeLearnerId?: string
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext
  }
  interface FastifyRequest {
    auth?: AuthInfo
  }
}

/** A route module: registers its routes under the API prefix. */
export type RouteModule = (app: FastifyInstance, ctx: AppContext) => Promise<void> | void
