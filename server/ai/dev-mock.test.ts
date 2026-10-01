import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ArtifactType, GenerationRequest, LearnerProfileInput } from '../../shared/contracts'
import { createTestDb, type DbHandle } from '../db/client'
import { generateArtifact } from '../generation/engine'
import { resolveRequest } from '../generation/request'
import { validateArtifact } from '../validation'
import { devMockText } from './dev-mock'
import { createAi } from './index'

let h: DbHandle
beforeAll(async () => (h = await createTestDb()))
afterAll(() => h.close())

const log = { info() {}, warn() {} }

describe('dev mock text model', () => {
  it.each(ArtifactType.options)('%s: mock-generated material passes validation (approvable)', async (type) => {
    const ai = createAi(
      { AI_TEXT_PROVIDER: 'mock', LIMIT_AI_REQUESTS_PER_HOUR: '10000' },
      { db: h.db, log, mock: { text: devMockText } },
    )
    for (const year of [2, 5]) {
      const profile = LearnerProfileInput.parse({ displayName: 'Test', school: { stage: 'grundskola', year } })
      const request = resolveRequest(
        GenerationRequest.parse({ learnerId: crypto.randomUUID(), type, questionCount: 12, skills: ['math.addition'] }),
        ['type', 'questionCount', 'skills'],
        {},
        profile,
      )
      const g = await generateArtifact(
        { db: h.db, text: ai.text! },
        { request, profile },
        { id: crypto.randomUUID(), learnerId: crypto.randomUUID(), createdBy: 'adult', version: 1 },
      )
      const report = await validateArtifact(g.artifact, { request })
      expect(
        report.issues.filter((i) => i.severity === 'error'),
        `${type} year ${year}`,
      ).toEqual([])
      expect(g.ok).toBe(true)
      expect(g.repaired).toBe(false)
    }
  })
})
