import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { FastifyRequest } from 'fastify'
import { CreationJobType, type ArtifactType, type CreationJob, type JobStatus } from '../../shared/contracts'
import type { RouteModule } from '../app/context'
import type { Db } from '../db/client'
import { artifacts, jobs, studySets } from '../db/schema'
import { HttpError, requireAdult, requireLearner } from '../gate/guards'
import { TYPE_SV } from '../validation/checks'
import { cancel, getStatus, retryFailed, toStatus, type JobRow } from './queue'

const Params = z.object({ id: z.string().uuid() })
const notFound = () => new HttpError(404, 'not_found', 'Hittades inte.')
const TERMINAL = new Set(['completed', 'failed', 'cancelled'])

export const SSE_POLL_MS = 1000
export const SSE_PING_MS = 15_000

/** Non-adults see only the learner message (the adult one can name internals). */
const forViewer = (req: FastifyRequest, s: JobStatus | undefined): JobStatus | undefined =>
  s?.error && !req.gate?.adult ? { ...s, error: { ...s.error, adultMessage: s.error.learnerMessage } } : s

const LearnerParams = z.object({ id: z.string().uuid() })
const ListQuery = z.object({ active: z.enum(['0', '1']).optional() })
/** Finished jobs listed besides every active one. */
export const RECENT_CREATIONS = 20
const CREATION_TYPES = CreationJobType.options

const excerpt = (t: string, n = 60) => {
  const one = t.trim().replace(/\s+/g, ' ')
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()} …` : one
}
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined)
const obj = (v: unknown) => (typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {})

/**
 * The learner's creation jobs, newest first: all active plus the last RECENT_CREATIONS. Adults see
 * every creation job; learners only the material they asked for themselves (createdBy 'learner').
 */
export async function listCreations(db: Db, learnerId: string, opts: { adult: boolean; activeOnly?: boolean }) {
  const scope = and(
    eq(jobs.learnerId, learnerId),
    opts.adult
      ? inArray(jobs.type, CREATION_TYPES)
      : and(eq(jobs.type, 'artifact.generate'), sql`${jobs.payload}->>'createdBy' = 'learner'`),
  )
  const active = await db
    .select()
    .from(jobs)
    .where(and(scope, inArray(jobs.state, ['queued', 'processing'])))
  const recent = opts.activeOnly
    ? []
    : await db.select().from(jobs).where(scope).orderBy(desc(jobs.createdAt)).limit(RECENT_CREATIONS)
  const rows = [...new Map([...active, ...recent].map((r) => [r.id, r])).values()].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )
  const artifactIdOf = (r: JobRow) =>
    r.type === 'artifact.regenerateItem'
      ? str(r.payload.artifactId)
      : r.state === 'completed'
        ? str(r.resultId)
        : undefined
  const aIds = [...new Set(rows.map(artifactIdOf).filter((x): x is string => !!x))]
  const setIds = [...new Set(rows.flatMap((r) => (r.type === 'study.process' && str(r.payload.setId)) || []))]
  const arts = new Map(
    (aIds.length
      ? await db
          .select({ id: artifacts.id, title: artifacts.title, approval: artifacts.approval })
          .from(artifacts)
          .where(and(inArray(artifacts.id, aIds), eq(artifacts.learnerId, learnerId)))
      : []
    ).map((a) => [a.id, a]),
  )
  const sets = new Map(
    (setIds.length
      ? await db
          .select({ id: studySets.id, title: studySets.title })
          .from(studySets)
          .where(inArray(studySets.id, setIds))
      : []
    ).map((x) => [x.id, x.title]),
  )
  return rows.map((r): CreationJob => {
    const st = toStatus(r)
    const aId = artifactIdOf(r)
    const art = aId ? arts.get(aId) : undefined
    const req = obj(r.payload.request)
    const title =
      r.type === 'study.process'
        ? `Läser in: ${sets.get(str(r.payload.setId) ?? '') ?? 'Studiematerial'}`
        : r.type === 'artifact.regenerateItem'
          ? `Ny version av en uppgift${art ? ` i ${art.title}` : ''}`
          : (art?.title ??
            (str(req.instructions)
              ? excerpt(req.instructions as string)
              : 'transform' in r.payload
                ? 'Omarbetat material'
                : [TYPE_SV[req.type as ArtifactType] ?? 'Material', str(req.topic) ?? str(req.theme)]
                    .filter(Boolean)
                    .join(': ')))
    const createdBy = str(r.payload.createdBy) as CreationJob['createdBy']
    return {
      id: st.id,
      type: r.type as CreationJob['type'],
      state: st.state,
      progress: st.progress,
      step: st.step,
      title: excerpt(title, 120),
      ...(createdBy && { createdBy }),
      resultId: st.resultId,
      artifactId: art?.id,
      approval: art?.approval,
      error: st.error && (opts.adult ? st.error : { ...st.error, adultMessage: st.error.learnerMessage }),
      createdAt: st.createdAt,
      updatedAt: st.updatedAt,
    }
  })
}

export const jobRoutes: RouteModule = (app, ctx) => {
  // Hijacked SSE responses keep their sockets open; end them so app.close() can finish.
  const streams = new Set<() => void>()
  app.addHook('preClose', async () => streams.forEach((end) => end()))

  app.get(
    '/jobs/:id',
    async (req) => forViewer(req, await getStatus(ctx.db, Params.parse(req.params).id)) ?? Promise.reject(notFound()),
  )

  // SSE: `event: status` with a JobStatus on every change; closes after a terminal state.
  // ponytail: per-connection DB polling (1 s); switch to LISTEN fan-out if many viewers.
  app.get('/jobs/:id/events', async (req, reply) => {
    const { id } = Params.parse(req.params)
    const load = async () => forViewer(req, await getStatus(ctx.db, id))
    let status = await load()
    if (!status) throw notFound()
    reply.hijack()
    const res = reply.raw
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    let last = ''
    let poll: NodeJS.Timeout | undefined
    const ping = setInterval(() => res.write(': ping\n\n'), SSE_PING_MS)
    const end = () => {
      streams.delete(end)
      clearInterval(ping)
      clearTimeout(poll)
      if (!res.writableEnded) res.end()
    }
    streams.add(end)
    req.raw.on('close', end)
    const tick = async () => {
      if (res.writableEnded) return
      if (!status) return end()
      const json = JSON.stringify(status)
      if (json !== last) res.write(`event: status\ndata: ${json}\n\n`)
      last = json
      if (TERMINAL.has(status.state)) return end()
      poll = setTimeout(async () => {
        status = await load().catch(() => status)
        await tick()
      }, SSE_POLL_MS)
    }
    await tick()
  })

  /** Creation jobs for the "Pågår och klart" lists; `?active=1` = only queued/processing (badges). */
  app.get('/learners/:id/jobs', async (req) => {
    const { id } = LearnerParams.parse(req.params)
    await requireLearner(ctx.db, id)
    const { active } = ListQuery.parse(req.query)
    return listCreations(ctx.db, id, { adult: !!req.gate?.adult, activeOnly: active === '1' })
  })

  app.post('/jobs/:id/cancel', async (req) => {
    requireAdult(req)
    const { id } = Params.parse(req.params)
    if (!(await cancel(ctx.db, id)) && !(await getStatus(ctx.db, id))) throw notFound()
    return (await getStatus(ctx.db, id))!
  })

  app.post('/jobs/:id/retry', async (req) => {
    requireAdult(req)
    const { id } = Params.parse(req.params)
    if (!(await retryFailed(ctx.db, id))) {
      if (!(await getStatus(ctx.db, id))) throw notFound()
      throw new HttpError(409, 'invalid_state', 'Bara misslyckade uppgifter kan köras om.')
    }
    return (await getStatus(ctx.db, id))!
  })
}
