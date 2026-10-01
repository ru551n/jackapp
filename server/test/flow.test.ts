import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Artifact, Item, JobStatus, LearningPath } from '../../shared/contracts'
import { createAi } from '../ai'
import type { ChatRequest } from '../ai/types'
import { loadArtifactVersion } from '../generation/store'
import { createWorker, type Worker } from '../jobs'
import { jobHandlers } from '../worker/handlers'
import { asAdult, createTestApp, TEST_ENV } from './helpers'

// The whole backend loop with the real worker, real routes and a scripted mock AI:
//
//   adult creates a learner (approval: parent) and plans a learning path
//   → path.plan job → milestone m1 → artifact.generate (system, skills) → pendingApproval
//   → learner can't see it; adult approves → learner runs it and struggles
//   → evidence → onEvidence inserts a remediation milestone → its lesson is generated, approved, run
//   → skill becomes secure → remediation done, m1 done, m2 activated with its own content.
//
// Plus the learner-mode guarantees: only approved material is listed, and end-feedback tests
// never leak answers.

const GOAL_SKILL = 'math.addition.tens-crossing'
const NEXT_SKILL = 'math.subtraction.tens-crossing'

/** Scripted text model, by structured-output schema name. */
function model(req: ChatRequest) {
  const js = req.json!.jsonSchema as any
  switch (req.json!.name) {
    case 'learning_path':
      return {
        milestones: [
          { title: 'Addition över tiotalet', skills: [GOAL_SKILL], refIds: [] },
          { title: 'Subtraktion över tiotalet', skills: [NEXT_SKILL], refIds: [] },
        ],
      }
    case 'request_fields':
      return {}
    case 'artifact_texts':
      return {
        title: 'Tiotalsövergångar',
        bodies: Array.from({ length: js.properties.bodies.minItems }, () => 'Text.'),
      }
    case 'artifact_items': {
      const it = js.properties.items.items
      const kinds: string[] = (it.anyOf ?? it.oneOf ?? [it]).map((o: any) => o.properties.kind.const)
      return { title: 'Övning', items: Array.from({ length: js.properties.items.minItems }, () => fakeItem(kinds)) }
    }
    default:
      throw new Error(`unexpected AI call ${req.json!.name}`)
  }
}

let n = 0
/** A correct, checkable item of the first supported kind; tagged with a finer skill than requested. */
function fakeItem(kinds: string[]) {
  const a = ++n + 6
  const common = { difficulty: 2, skills: [`${GOAL_SKILL}.within-20`], hints: ['Räkna upp till tio först.'] }
  if (kinds.includes('trueFalse'))
    return { kind: 'trueFalse', prompt: `Stämmer det att ${a} + 7 = ${a + 7}?`, answer: true, ...common }
  if (kinds.includes('numeric'))
    return { kind: 'numeric', prompt: `Räkna ${a} + 7.`, answer: a + 7, check: `${a}+7`, ...common }
  return {
    kind: 'multipleChoice',
    prompt: `Vad är ${a} + 7?`,
    choices: [`${a + 7}`, `${a + 8}`],
    correctIndex: 0,
    ...common,
  }
}

/** The right (or a wrong) answer in the shape runs expect. */
function answerFor(item: Item, right: boolean): unknown {
  switch (item.kind) {
    case 'trueFalse':
      return right === item.answer
    case 'numeric':
      return String(right ? item.answer : item.answer + 1)
    case 'multipleChoice':
      return right ? item.answer : item.choices.find((c) => c.id !== item.answer)!.id
    default:
      throw new Error(`no scripted answer for ${item.kind}`)
  }
}

let t: Awaited<ReturnType<typeof createTestApp>>
let worker: Worker
let learnerId: string

beforeAll(async () => {
  t = await createTestApp({ ctx: { loadArtifactVersion } })
  const ai = createAi(
    { AI_TEXT_PROVIDER: 'mock', LIMIT_AI_REQUESTS_PER_HOUR: '10000' },
    { db: t.db, log: quiet, mock: { text: model } },
  )
  worker = createWorker({
    db: t.db,
    log: quiet,
    handlers: jobHandlers({ db: t.db, env: TEST_ENV, ai, log: quiet }),
    pollMs: 20,
    schedules: [],
  })
  await worker.start()
})
afterAll(async () => {
  await worker.stop(1000)
  await t.close()
})

const quiet = { info() {}, warn() {}, error() {}, debug() {}, child: () => quiet } as never

// ---- small API helpers (adult = gate open, learner = no header) ----

const api = async (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object, adult = false) => {
  const r = await t.app.inject({ method, url: `/api/v1${url}`, payload, headers: adult ? asAdult : {} })
  return { status: r.statusCode, body: r.body ? r.json() : undefined }
}
const adult = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) => api(method, url, payload, true)
const learner = (method: 'GET' | 'POST', url: string, payload?: object) => api(method, url, payload, false)

async function until<T>(what: string, fn: () => Promise<T | undefined | false>, ms = 60_000): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 25))
  }
}

/** Wait for a job to finish; its resultId (fails the test with the adult message on failure). */
async function settled(jobId: string): Promise<string> {
  const s = await until(`job ${jobId}`, async () => {
    const st = (await adult('GET', `/jobs/${jobId}`)).body as JobStatus
    return ['completed', 'failed', 'cancelled'].includes(st.state) && st
  })
  expect(s.error?.adultMessage, s.type).toBeUndefined()
  return s.resultId!
}

const path = async (id: string) => (await learner('GET', `/learners/${learnerId}/paths/${id}`)).body as LearningPath
const fullArtifact = async (id: string) => (await adult('GET', `/artifacts/${id}`)).body.artifact as Artifact
const itemsOf = (a: Artifact) => a.sections.flatMap((s) => s.items)

/** Learner runs an artifact: `wrong` items are missed until revealed, the rest answered right first time. */
async function run(artifactId: string, opts: { wrong?: number; only?: number } = {}) {
  const items = itemsOf(await fullArtifact(artifactId)).slice(0, opts.only)
  const start = await learner('POST', `/learners/${learnerId}/runs`, { artifactId })
  expect(start.status).toBe(201)
  const runId = start.body.id as string
  for (const [i, item] of items.entries()) {
    const right = i >= (opts.wrong ?? 0)
    for (let attempt = 1; ; attempt++) {
      const r = await learner('POST', `/learners/${learnerId}/runs/${runId}/answers`, {
        itemId: item.id,
        answer: answerFor(item, right),
      })
      expect(r.status).toBe(200)
      expect(JSON.stringify(r.body)).not.toMatch(/\bfel\b/i) // calm wording, always
      if (r.body.done) break
      expect(attempt).toBeLessThan(3) // middle band reveals after 3 tries
    }
  }
  return runId
}

describe('full backend flow: path → generate → approve → run → evidence → adaptation', () => {
  let pathId: string
  let m1Artifact: string

  it('an adult sets up a learner whose material needs approval and plans a path', async () => {
    const created = await adult('POST', '/learners', {
      displayName: 'Alva',
      school: { stage: 'grundskola', year: 4 },
      generation: { approval: 'parent', learnerRequestsAllowed: true },
    })
    expect(created.status).toBe(201)
    learnerId = created.body.id

    const plan = await adult('POST', `/learners/${learnerId}/paths`, { goal: 'Klara tiotalsövergångar' })
    expect(plan.status).toBe(202)
    pathId = await settled(plan.body.jobId)
    const p = await path(pathId)
    expect(p.milestones.map((m) => [m.title, m.status])).toEqual([
      ['Addition över tiotalet', 'active'],
      ['Subtraktion över tiotalet', 'upcoming'],
    ])
  })

  it("generates the active milestone's lesson with its skill tags, waiting for approval", async () => {
    m1Artifact = await until('m1 content', async () => (await path(pathId)).milestones[0]!.artifactIds[0])
    const a = await fullArtifact(m1Artifact)
    expect(a).toMatchObject({ type: 'lesson', approval: 'pendingApproval', createdBy: 'system' })
    expect(a.validation.ok).toBe(true)
    // GenerationRequest.skills: the model's finer tag under the milestone skill is kept.
    expect(new Set(itemsOf(a).flatMap((i) => i.skills))).toEqual(new Set([`${GOAL_SKILL}.within-20`]))
  })

  it('learner mode sees only approved material', async () => {
    expect((await learner('GET', `/learners/${learnerId}/artifacts`)).body).toEqual([])
    expect((await learner('GET', `/artifacts/${m1Artifact}`)).status).toBe(404)
    expect((await learner('POST', `/learners/${learnerId}/runs`, { artifactId: m1Artifact })).status).toBe(403)
    expect((await adult('GET', `/learners/${learnerId}/artifacts`)).body).toHaveLength(1)

    expect((await adult('POST', `/artifacts/${m1Artifact}/approve`)).status).toBe(200)
    const list = (await learner('GET', `/learners/${learnerId}/artifacts`)).body
    expect(list.map((x: { id: string; approval: string }) => [x.id, x.approval])).toEqual([[m1Artifact, 'approved']])
  })

  it('struggling on the milestone inserts a remediation milestone with its own lesson', async () => {
    // Four items missed until revealed ("helped") → needsSupport with enough answers since activation.
    await run(m1Artifact, { wrong: 4, only: 4 })
    const p = await until('remediation milestone', async () => {
      const x = await path(pathId)
      return x.milestones.length === 3 && x
    })
    expect(p.milestones.map((m) => m.status)).toEqual(['active', 'upcoming', 'upcoming'])
    expect(p.milestones[0]!.title).toMatch(/^Extra träning/)
    expect(p.milestones[0]!.skills).toEqual([GOAL_SKILL])

    const skills = (await adult('GET', `/learners/${learnerId}/skills`)).body.skills
    expect(skills.find((s: { skill: string }) => s.skill === GOAL_SKILL)).toMatchObject({
      status: 'needsSupport',
      evidenceCount: 4,
    })
  })

  it('practising the remediation lesson secures the skill and the path moves on to m2', async () => {
    const remediation = await until(
      'remediation content',
      async () => (await path(pathId)).milestones[0]!.artifactIds[0],
    )
    const r = await fullArtifact(remediation)
    expect(r).toMatchObject({ type: 'lesson', approval: 'pendingApproval' })
    expect(itemsOf(r)).toHaveLength(8) // repetition 'normal'
    expect((await adult('POST', `/artifacts/${remediation}/approve`)).status).toBe(200)

    await run(remediation)
    const p = await until('m2 active', async () => {
      const x = await path(pathId)
      return x.milestones[2]!.status === 'active' && x
    })
    expect(p.milestones.map((m) => m.status)).toEqual(['done', 'done', 'active'])
    expect(p.status).toBe('active')
    const skills = (await adult('GET', `/learners/${learnerId}/skills`)).body.skills
    expect(skills.find((s: { skill: string }) => s.skill === GOAL_SKILL).status).toBe('secure')

    // m2 gets its own content, tagged with its skill (the model's off-list tag is replaced).
    const m2 = await until('m2 content', async () => (await path(pathId)).milestones[2]!.artifactIds[0])
    expect(new Set(itemsOf(await fullArtifact(m2)).flatMap((i) => i.skills))).toEqual(new Set([NEXT_SKILL]))
  })

  it('an end-feedback test never shows answers to the learner while it is active', async () => {
    const gen = await adult('POST', `/learners/${learnerId}/generate`, {
      type: 'practiceTest',
      topic: 'Addition',
      feedback: 'end',
      questionCount: 3,
      itemKinds: ['trueFalse', 'numeric'],
    })
    const testId = await settled(gen.body.jobId)
    expect((await adult('POST', `/artifacts/${testId}/approve`)).status).toBe(200)

    const view = await learner('GET', `/artifacts/${testId}`)
    expect(view.status).toBe(200)
    for (const item of itemsOf(view.body.artifact)) {
      expect(item).not.toHaveProperty('answer')
      expect(item).not.toHaveProperty('explanation')
      expect(item).not.toHaveProperty('check')
    }
    expect(view.body.artifact).not.toHaveProperty('validation')

    const started = await learner('POST', `/learners/${learnerId}/runs`, { artifactId: testId })
    expect(started.status).toBe(201)
    expect(started.body.mode).toBe('test')
    expect(JSON.stringify(started.body.items)).not.toMatch(/"answer"|"explanation"|"check"/)
    const first = started.body.items[0]
    const saved = await learner('POST', `/learners/${learnerId}/runs/${started.body.id}/answers`, {
      itemId: first.id,
      answer: first.kind === 'trueFalse' ? true : '1',
    })
    expect(saved.body).toMatchObject({ correct: null, message: 'Svaret är sparat.' })
    expect(saved.body).not.toHaveProperty('solution')
  })
})
