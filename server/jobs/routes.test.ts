import { afterEach, describe, expect, it } from 'vitest'
import { JobStatus } from '../../shared/contracts'
import { asAdult, createTestApp } from '../test/helpers'
import { claim, complete, enqueue, failAttempt, progressWriter } from './queue'

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  await close?.()
  close = undefined
})

const parseSse = (body: string) =>
  body
    .split('\n\n')
    .filter((b) => b.startsWith('event: status'))
    .map((b) => JobStatus.parse(JSON.parse(b.split('\ndata: ')[1]!)))

describe('job routes', () => {
  it('returns status, 404s unknown ids and 400s bad ids', async () => {
    const t = await createTestApp()
    close = t.close
    const { id } = await enqueue(t.db, { type: 'curriculum.sync', payload: {} })
    const r = await t.app.inject(`/api/v1/jobs/${id}`)
    expect(JobStatus.parse(r.json())).toMatchObject({ id, state: 'queued' })
    expect((await t.app.inject(`/api/v1/jobs/${crypto.randomUUID()}`)).statusCode).toBe(404)
    expect((await t.app.inject('/api/v1/jobs/nope')).statusCode).toBe(400)
  })

  it('cancel and retry are adult-only', async () => {
    const t = await createTestApp()
    close = t.close
    const { id } = await enqueue(t.db, { type: 'curriculum.sync', payload: {} })
    expect((await t.app.inject({ method: 'POST', url: `/api/v1/jobs/${id}/cancel` })).statusCode).toBe(403)
    expect((await t.app.inject({ method: 'POST', url: `/api/v1/jobs/${id}/retry`, headers: asAdult })).statusCode).toBe(
      409,
    )
    const c = await t.app.inject({ method: 'POST', url: `/api/v1/jobs/${id}/cancel`, headers: asAdult })
    expect(c.json()).toMatchObject({ state: 'cancelled' })

    const b = await enqueue(t.db, { type: 'curriculum.sync', payload: {} })
    const job = (await claim(t.db, 'w', ['curriculum.sync']))!
    await failAttempt(t.db, job, 'w', { code: 'x', learnerMessage: 'l', adultMessage: 'a', retryable: false })
    const r = await t.app.inject({ method: 'POST', url: `/api/v1/jobs/${b.id}/retry`, headers: asAdult })
    expect(r.json()).toMatchObject({ state: 'queued', attempts: 0 })
  })

  it('streams state and progress over SSE and closes when finished', async () => {
    const t = await createTestApp()
    close = t.close
    const { id } = await enqueue(t.db, { type: 'curriculum.sync', payload: {} })
    const res = t.app.inject(`/api/v1/jobs/${id}/events`)
    setTimeout(async () => {
      await claim(t.db, 'w', ['curriculum.sync'])
      await new Promise((r) => setTimeout(r, 1200))
      await progressWriter(t.db, id, 'w')(0.5, 'Halvvägs')
      await new Promise((r) => setTimeout(r, 1200))
      await complete(t.db, id, 'w', 'res')
    }, 100)
    const r = await res
    expect(r.headers['content-type']).toMatch(/text\/event-stream/)
    expect(r.headers['x-accel-buffering']).toBe('no')
    const events = parseSse(r.body)
    expect(events[0]!.state).toBe('queued')
    expect(events.some((e) => e.state === 'processing' && e.progress === 0.5 && e.step === 'Halvvägs')).toBe(true)
    expect(events.at(-1)).toMatchObject({ state: 'completed', resultId: 'res' })
  })

  it('shows the adult failure message to adults only', async () => {
    const t = await createTestApp()
    close = t.close
    const { id } = await enqueue(t.db, { type: 'curriculum.sync', payload: {} })
    const job = (await claim(t.db, 'w', ['curriculum.sync']))!
    const error = { code: 'x', learnerMessage: 'Det gick inte.', adultMessage: 'Intern detalj', retryable: false }
    await failAttempt(t.db, job, 'w', error)
    const kid = await t.app.inject(`/api/v1/jobs/${id}`)
    expect(kid.json().error).toEqual({ ...error, adultMessage: 'Det gick inte.' })
    expect((await t.app.inject(`/api/v1/jobs/${id}/events`)).body).not.toContain('Intern detalj')
    expect((await t.app.inject({ url: `/api/v1/jobs/${id}`, headers: asAdult })).json().error).toEqual(error)
  })

  it('app.close() ends open SSE streams instead of hanging', async () => {
    const t = await createTestApp()
    const { id } = await enqueue(t.db, { type: 'curriculum.sync', payload: {} })
    await t.app.listen({ port: 0, host: '127.0.0.1' })
    const { port } = t.app.server.address() as { port: number }
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/jobs/${id}/events`)
    const reader = res.body!.getReader()
    await reader.read() // first status event
    const closed = await Promise.race([
      t.close().then(() => true),
      new Promise((r) => setTimeout(() => r(false), 3000)),
    ])
    expect(closed).toBe(true)
  })
})
