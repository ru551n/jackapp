import fastifyStatic from '@fastify/static'
import Fastify, { type FastifyServerOptions } from 'fastify'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { ZodError } from 'zod'
import { API_PREFIX } from '../../shared/contracts'
import { safeErr } from '../db/client'
import { HttpError, sendError } from '../gate/guards'
import { registerGate } from '../gate/plugin'
import type { AppContext, ReadinessCheck } from './context'
import { ROUTE_MODULES } from './routes'

export interface BuildOptions {
  ctx: Omit<AppContext, 'log'>
  logger?: FastifyServerOptions['logger']
  /** Fastify trustProxy value derived from TRUST_PROXY (never `true` blindly). */
  trustProxy?: FastifyServerOptions['trustProxy']
  /** Built web app (WEB_DIST_DIR). Served at / when it contains index.html; hash routing needs no SPA fallback. */
  webDistDir?: string
}

export async function runReadiness(checks: ReadinessCheck[]) {
  const results = await Promise.all(
    checks.map(async (c) => {
      try {
        return { name: c.name, critical: c.critical, ...(await c.check()) }
      } catch {
        return { name: c.name, critical: c.critical, ok: false, detail: 'check failed' }
      }
    }),
  )
  return { ready: results.every((r) => r.ok || !r.critical), checks: results }
}

export async function buildApp(opts: BuildOptions) {
  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: opts.trustProxy ?? false,
  })
  const ctx: AppContext = { ...opts.ctx, log: app.log }
  app.decorate('ctx', ctx)

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) return sendError(reply, err)
    if (err instanceof ZodError)
      return reply.status(400).send({ error: { code: 'invalid_request', message: 'Ogiltig förfrågan.' } })
    const status = (err as { statusCode?: number }).statusCode
    if (status && status < 500)
      return reply.status(status).send({ error: { code: 'invalid_request', message: 'Ogiltig förfrågan.' } })
    // Name + SQLSTATE only: driver messages can carry SQL params (learner content).
    req.log.error({ err: safeErr(err) }, 'unhandled error')
    return reply.status(500).send({ error: { code: 'internal', message: 'Något gick fel. Försök igen senare.' } })
  })

  /** Liveness: the process is up. */
  app.get('/health', async () => ({ status: 'ok' }))

  /** Readiness: critical dependencies OK. Details are safe (names + coarse status only). */
  app.get('/ready', async (_req, reply) => {
    const r = await runReadiness(ctx.readiness)
    return reply.status(r.ready ? 200 : 503).send(r)
  })

  await registerGate(app, ctx)
  await app.register(
    async (api) => {
      for (const mod of ROUTE_MODULES) await mod(api, ctx)
    },
    { prefix: API_PREFIX },
  )

  if (opts.webDistDir && existsSync(resolve(opts.webDistDir, 'index.html')))
    await app.register(fastifyStatic, { root: resolve(opts.webDistDir) })
  else if (opts.webDistDir) app.log.warn({ webDistDir: opts.webDistDir }, 'web app not built; static serving disabled')
  return app
}
