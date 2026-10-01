import { z } from 'zod'
import type { RouteModule } from '../app/context'
import { HttpError, requireAdult } from '../gate/guards'
import { cancel, getStatus, retryFailed } from './queue'

const Params = z.object({ id: z.string().uuid() })
const notFound = () => new HttpError(404, 'not_found', 'Hittades inte.')
const TERMINAL = new Set(['completed', 'failed', 'cancelled'])

export const SSE_POLL_MS = 1000
export const SSE_PING_MS = 15_000

export const jobRoutes: RouteModule = (app, ctx) => {
  app.get(
    '/jobs/:id',
    async (req) => (await getStatus(ctx.db, Params.parse(req.params).id)) ?? Promise.reject(notFound()),
  )

  // SSE: `event: status` with a JobStatus on every change; closes after a terminal state.
  // ponytail: per-connection DB polling (1 s); switch to LISTEN fan-out if many viewers.
  app.get('/jobs/:id/events', async (req, reply) => {
    const { id } = Params.parse(req.params)
    let status = await getStatus(ctx.db, id)
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
      clearInterval(ping)
      clearTimeout(poll)
      if (!res.writableEnded) res.end()
    }
    req.raw.on('close', end)
    const tick = async () => {
      if (res.writableEnded) return
      if (!status) return end()
      const json = JSON.stringify(status)
      if (json !== last) res.write(`event: status\ndata: ${json}\n\n`)
      last = json
      if (TERMINAL.has(status.state)) return end()
      poll = setTimeout(async () => {
        status = await getStatus(ctx.db, id).catch(() => status)
        await tick()
      }, SSE_POLL_MS)
    }
    await tick()
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
