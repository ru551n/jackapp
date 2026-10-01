import { afterEach, describe, expect, it } from 'vitest'
import { JobStatus } from '../../shared/contracts'
import { asAdult, createTestApp } from '../test/helpers'
import { claim, complete, enqueue, failAttempt, progressWriter } from './queue'

let close: (() => Promise<void>) | undefined
afterEach(async () => close?.())

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
})
