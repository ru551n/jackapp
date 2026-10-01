import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { CreationJob, JobStatus } from '../../shared/contracts'
import { artifacts, jobs, studySets } from '../db/schema'
import { asAdult, createTestApp, seedLearner } from '../test/helpers'
import { claim, complete, enqueue, failAttempt, progressWriter } from './queue'
import { RECENT_CREATIONS } from './routes'

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

describe('GET /learners/:id/jobs', () => {
  const at = (min: number) => new Date(Date.UTC(2026, 0, 1, 12, min))
  const request = (learnerId: string, extra: Record<string, unknown>) => ({
    learnerId,
    type: 'exercises',
    ...extra,
  })

  it('scopes adults to all creation jobs and learners to their own requests, newest first, without payloads', async () => {
    const t = await createTestApp()
    close = t.close
    const l = await seedLearner(t.db)
    const other = await seedLearner(t.db)
    const [set] = await t.db
      .insert(studySets)
      .values({ learnerId: l.id, title: 'Kemi kapitel 3', status: 'processing' })
      .returning()
    const [art] = await t.db
      .insert(artifacts)
      .values({
        learnerId: l.id,
        type: 'practiceTest',
        title: 'Prov om bråk',
        school: l.profile.school,
        sourceMode: 'sourceAndCurriculum',
        feedback: 'immediate',
        approval: 'pendingApproval',
        createdBy: 'learner',
        request: request(l.id, {}) as never,
      })
      .returning()
    const learnerReq = {
      request: request(l.id, { instructions: 'Jag vill lära mig bråk med flygplan' }),
      createdBy: 'learner',
    }
    await t.db.insert(jobs).values([
      {
        type: 'artifact.generate',
        learnerId: l.id,
        createdAt: at(1),
        payload: { request: request(l.id, { instructions: 'HEMLIG vuxeninstruktion om mående' }), createdBy: 'adult' },
      },
      { type: 'study.process', learnerId: l.id, createdAt: at(2), payload: { setId: set!.id } },
      {
        type: 'artifact.generate',
        learnerId: l.id,
        createdAt: at(3),
        state: 'completed',
        resultId: art!.id,
        payload: learnerReq,
      },
      { type: 'artifact.generate', learnerId: l.id, createdAt: at(4), payload: learnerReq },
      { type: 'image.generate', learnerId: l.id, createdAt: at(5), payload: {} },
      { type: 'artifact.generate', learnerId: other.id, createdAt: at(6), payload: learnerReq },
      {
        type: 'artifact.generate',
        learnerId: l.id,
        createdAt: at(7),
        state: 'failed',
        lastError: { code: 'x', learnerMessage: 'Det gick inte.', adultMessage: 'Intern detalj', retryable: true },
        payload: { request: request(l.id, { type: 'lesson', topic: 'Vulkaner' }), createdBy: 'adult' },
      },
    ])
    const adult = await t.app.inject({ url: `/api/v1/learners/${l.id}/jobs`, headers: asAdult })
    const list = z.array(CreationJob).parse(adult.json())
    expect(list.map((j) => j.title)).toEqual([
      'Lektion: Vulkaner',
      'Jag vill lära mig bråk med flygplan',
      'Prov om bråk',
      'Läser in: Kemi kapitel 3',
      'HEMLIG vuxeninstruktion om mående',
    ])
    expect(list[0]!.error?.adultMessage).toBe('Intern detalj')
    expect(list[2]).toMatchObject({ state: 'completed', artifactId: art!.id, approval: 'pendingApproval' })
    // Only contract fields: no payload, request or ids from it.
    for (const j of adult.json()) expect(Object.keys(j).filter((k) => !(k in CreationJob.shape))).toEqual([])
    expect(adult.body).not.toContain(set!.id)

    const kid = await t.app.inject(`/api/v1/learners/${l.id}/jobs`)
    const mine = z.array(CreationJob).parse(kid.json())
    expect(mine.map((j) => j.title)).toEqual(['Jag vill lära mig bråk med flygplan', 'Prov om bråk'])
    expect(kid.body).not.toContain('HEMLIG')
    expect(kid.body).not.toContain('Intern detalj')

    const active = z
      .array(CreationJob)
      .parse((await t.app.inject({ url: `/api/v1/learners/${l.id}/jobs?active=1`, headers: asAdult })).json())
    expect(active.map((j) => j.state)).toEqual(['queued', 'queued', 'queued'])
    expect((await t.app.inject(`/api/v1/learners/${crypto.randomUUID()}/jobs`)).statusCode).toBe(404)
  })

  it('learners see only the learner message, and old active jobs stay listed past the recent limit', async () => {
    const t = await createTestApp()
    close = t.close
    const l = await seedLearner(t.db)
    const payload = { request: request(l.id, {}), createdBy: 'learner' }
    await t.db.insert(jobs).values([
      { type: 'artifact.generate', learnerId: l.id, createdAt: at(0), payload },
      ...Array.from({ length: RECENT_CREATIONS + 3 }, (_, i) => ({
        type: 'artifact.generate' as const,
        learnerId: l.id,
        createdAt: at(i + 1),
        state: 'failed' as const,
        lastError: { code: 'x', learnerMessage: 'Det gick inte.', adultMessage: 'Intern', retryable: false },
        payload,
      })),
    ])
    const list = z.array(CreationJob).parse((await t.app.inject(`/api/v1/learners/${l.id}/jobs`)).json())
    expect(list).toHaveLength(RECENT_CREATIONS + 1)
    expect(list.at(-1)!.state).toBe('queued')
    expect(list[0]!.error).toMatchObject({ learnerMessage: 'Det gick inte.', adultMessage: 'Det gick inte.' })
  })
})
