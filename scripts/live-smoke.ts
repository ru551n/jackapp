// Manual live smoke test against a real AI provider (never part of CI). Uses in-process Postgres.
//   OPENAI_API_KEY=... npx tsx scripts/live-smoke.ts [model]
// Runs: natural-language generation → study upload + vision processing → strict practice test.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { pino } from 'pino'
import { eq } from 'drizzle-orm'
import { createAi } from '../server/ai'
import { buildApp } from '../server/app/build'
import { CoreEnv } from '../server/config/env'
import { syncBundledCurriculum } from '../server/curriculum/service'
import { createTestDb } from '../server/db/client'
import { jobs } from '../server/db/schema'
import { jobsServices, createWorker } from '../server/jobs'
import { loadArtifact } from '../server/generation/store'
import { jobHandlers } from '../server/worker/handlers'
import { LearnerProfileInput } from '../shared/contracts'
import { learners } from '../server/db/schema'

const key = process.env.OPENAI_API_KEY
if (!key) throw new Error('set OPENAI_API_KEY')
const model = process.argv[2] ?? 'gpt-5.4-mini'
const dataDir = mkdtempSync(join(tmpdir(), 'jackapp-live-'))
const aiEnv = {
  AI_TEXT_PROVIDER: 'openai',
  AI_TEXT_API_KEY: key,
  AI_TEXT_MODEL: model,
  AI_VISION_PROVIDER: 'openai',
  AI_VISION_API_KEY: key,
  AI_VISION_MODEL: model,
  LIMIT_AI_REQUESTS_PER_HOUR: '500',
}
Object.assign(process.env, { DATA_DIR: dataDir })
const log = pino({ level: 'warn' })
const env = CoreEnv.parse({
  NODE_ENV: 'test',
  PUBLIC_URL: 'http://localhost',
  DATABASE_URL: 'pglite',
  APP_SECRET: 'x'.repeat(40),
  DATA_DIR: dataDir,
})

const { db, close } = await createTestDb()
await syncBundledCurriculum(db, log)
const ai = createAi(aiEnv, { db, log })
const handlers = jobHandlers({ db, env, ai, log })
const worker = createWorker({ db, log, handlers, concurrency: 2, pollMs: 300 })
await worker.start()

const profile = LearnerProfileInput.parse({
  displayName: 'Testbarn',
  school: { stage: 'grundskola', year: 4 },
  interests: ['tåg', 'flygplan'],
  support: { textAmount: 'reduced', visualSupport: 'high', maxChoices: 3 },
})
const [learner] = await db.insert(learners).values({ profile }).returning()

const app = await buildApp({ ctx: { env, db, readiness: [], ai, jobs: jobsServices({ db }) } })
app.addHook('onRequest', async (req) => void (req.gate = { adult: true }))
const base = await app.listen({ port: 0, host: '127.0.0.1' })

async function waitJob(id: string) {
  for (let i = 0; i < 600; i++) {
    const [j] = await db.select().from(jobs).where(eq(jobs.id, id))
    if (j && ['completed', 'failed', 'cancelled'].includes(j.state)) return j
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('timeout')
}

function describeArtifact(a: Awaited<ReturnType<typeof loadArtifact>>) {
  if (!a) return 'no artifact'
  const items = a.artifact.sections.flatMap((s) => s.items)
  const issues = a.artifact.validation.issues.map((i) => `${i.severity}:${i.code}`)
  return [
    `"${a.artifact.title}" (${a.artifact.type}, approval=${a.artifact.approval}, ok=${a.artifact.validation.ok})`,
    `sections: ${a.artifact.sections.map((s) => s.kind).join(' → ')}`,
    `items: ${items.length} [${[...new Set(items.map((i) => i.kind))].join(', ')}]`,
    `issues: ${issues.join(', ') || 'none'}`,
    ...items.slice(0, 3).map((i) => `  • ${i.prompt.slice(0, 110)}`),
  ].join('\n')
}

const t0 = Date.now()
try {
  // 1. Natural-language request (parent-driven).
  const gen = await fetch(`${base}/api/v1/learners/${learner!.id}/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'exercises',
      instructions: 'Skapa 6 matteuppgifter för årskurs 4 om multiplikation. Använd tåg som tema, lite text.',
    }),
  }).then((r) => r.json())
  const j1 = await waitJob(gen.jobId)
  console.log(`\n[1] generation job: ${j1.state} ${j1.lastError ? JSON.stringify(j1.lastError) : ''}`)
  if (j1.resultId) console.log(describeArtifact(await loadArtifact(db, j1.resultId)))

  // 2. A "photographed" study page → upload → vision processing.
  const page = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="100%" height="100%" fill="#fbf8f0"/>
  <text x="60" y="90" font-size="48" font-family="sans-serif" font-weight="bold">Fotosyntesen</text>
  <text x="60" y="170" font-size="30" font-family="sans-serif">Växter tillverkar sin egen näring genom fotosyntes.</text>
  <text x="60" y="220" font-size="30" font-family="sans-serif">De behöver solljus, vatten och koldioxid.</text>
  <text x="60" y="270" font-size="30" font-family="sans-serif">I bladen finns klorofyll som fångar ljuset.</text>
  <text x="60" y="320" font-size="30" font-family="sans-serif">Växten bildar socker (glukos) och släpper ut syre.</text>
  <text x="60" y="400" font-size="34" font-family="sans-serif" font-weight="bold">Ord att kunna</text>
  <text x="60" y="450" font-size="30" font-family="sans-serif">klorofyll – grönt ämne i bladen</text>
  <text x="60" y="500" font-size="30" font-family="sans-serif">koldioxid – gas som växten tar upp ur luften</text>
  <text x="60" y="550" font-size="30" font-family="sans-serif">syre – gas som växten släpper ut</text></svg>`
  const png = await sharp(Buffer.from(page)).png().toBuffer()
  const form = new FormData()
  form.append('title', 'Fotosyntes – läxa')
  form.append('file', new Blob([png], { type: 'image/png' }), 'sida1.png')
  const up = await fetch(`${base}/api/v1/learners/${learner!.id}/study-sets`, { method: 'POST', body: form }).then(
    (r) => r.json(),
  )
  const j2 = await waitJob(up.jobId)
  console.log(`\n[2] study processing: ${j2.state} ${j2.lastError ? JSON.stringify(j2.lastError) : ''}`)
  const material = await fetch(`${base}/api/v1/learners/${learner!.id}/study-sets/${up.set.id}/material`).then((r) =>
    r.json(),
  )
  if (material.segments) {
    console.log(
      `topic: ${material.topic} | subject: ${material.subjectGuess ?? '-'} | segments: ${material.segments.length}`,
    )
    console.log(`concepts: ${material.concepts.slice(0, 6).join(', ')}`)
    console.log(`curriculum refs: ${material.curriculumRefs.length}`)
  }

  // 3. Strict-mode practice test from the uploaded page.
  const test = await fetch(`${base}/api/v1/learners/${learner!.id}/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'practiceTest', studySetId: up.set.id, sourceMode: 'strict', questionCount: 5 }),
  }).then((r) => r.json())
  const j3 = await waitJob(test.jobId)
  console.log(`\n[3] strict practice test: ${j3.state} ${j3.lastError ? JSON.stringify(j3.lastError) : ''}`)
  if (j3.resultId) console.log(describeArtifact(await loadArtifact(db, j3.resultId)))
} finally {
  console.log(`\ntotal ${Math.round((Date.now() - t0) / 1000)} s`)
  await worker.stop(5000)
  await app.close()
  await close()
}
