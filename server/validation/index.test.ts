import { describe, expect, it } from 'vitest'
import type { CurriculumRef } from '../../shared/contracts'
import { mockChat, type MockChatHandler } from '../ai/mock'
import { generate } from '../ai/structured'
import type { TextGeneration } from '../ai/types'
import { createTestDb } from '../db/client'
import { MATERIAL, artifact, codes, item, request, upload } from './fixtures'
import { validateArtifact, validateItem } from './index'

const REF: CurriculumRef = {
  source: 'skolverket',
  version: '2026-10-01',
  subjectCode: 'GRGRMAT01',
  stage: 'grundskola',
  span: '1-3',
}
const mockText = (handler?: MockChatHandler): TextGeneration =>
  ({ generate: (input: never) => generate(mockChat('mock-text', handler), 'auto', input) }) as TextGeneration

describe('validateArtifact', () => {
  it('passes good content and lists the checks that ran', async () => {
    const r = await validateArtifact(artifact([item('numeric'), item('trueFalse')]), { request: request() })
    expect(r).toMatchObject({ ok: true, issues: [] })
    expect(r.checks).toEqual(['schema', 'answers', 'math', 'leakage', 'language', 'age', 'safety', 'grounding'])
    expect(Date.parse(r.checkedAt)).not.toBeNaN()
  })

  it('stops at the contract parse when the artifact is malformed', async () => {
    const bad = { ...artifact([item('trueFalse')]), sections: [] }
    const r = await validateArtifact(bad, { request: request() })
    expect(r.ok).toBe(false)
    expect(r.checks).toEqual(['schema'])
    expect(codes(r.issues)).toEqual(['schema.invalid'])
    expect(r.issues[0]!.message).toContain('sections')
  })

  it('errors make ok false, warnings do not', async () => {
    const wrong = await validateArtifact(artifact([item('numeric', { answer: 55 })]), { request: request() })
    expect(wrong.ok).toBe(false)
    expect(wrong.issues[0]).toMatchObject({ severity: 'error', code: 'math.answer_mismatch', itemId: 'i-numeric' })
    const warned = await validateArtifact(
      artifact([item('trueFalse', { prompt: 'Andra världskriget slutade 1945.' })]),
      {
        request: request(),
      },
    )
    expect(warned.ok).toBe(true)
    expect(codes(warned.issues)).toEqual(['safety.borderline'])
  })

  it('scans title and section text for safety', async () => {
    const a = artifact([item('trueFalse')], { title: 'Vapen genom tiderna' })
    expect(codes((await validateArtifact(a, { request: request() })).issues)).toEqual(['safety.blocked'])
  })

  it('reports missing material once, as an error in strict mode', async () => {
    const i = (id: string) => item('trueFalse', { id, sources: [upload('s1', 1)] })
    const r = await validateArtifact(artifact([i('a'), i('b')], { sourceMode: 'strict' }), { request: request() })
    expect(r.issues.filter((x) => x.code === 'grounding.material_missing')).toHaveLength(1)
    expect(r.ok).toBe(false)
  })

  it('grounds strict content against the material', async () => {
    const i = item('trueFalse', {
      prompt: 'Vattenångan kyls av och bildar moln.',
      sources: [upload('s3', 2, 'bildar moln')],
    })
    const a = artifact([i], { sourceMode: 'strict', school: { stage: 'grundskola', year: 5 } })
    expect((await validateArtifact(a, { request: request(), material: MATERIAL })).issues).toEqual([])
  })
})

describe('curriculum', () => {
  const withRef = () =>
    artifact([item('trueFalse', { curriculumRefs: [REF], sources: [{ kind: 'curriculum', ref: REF }] })])

  it('uses an injected validator, deduplicating lookups', async () => {
    const seen: CurriculumRef[] = []
    const r = await validateArtifact(withRef(), {
      request: request(),
      isValidRef: async (ref) => (seen.push(ref), true),
    })
    expect(r.ok).toBe(true)
    expect(r.checks).toContain('curriculum')
    expect(seen).toHaveLength(1)
  })

  it('flags invalid refs as errors', async () => {
    const r = await validateArtifact(withRef(), { request: request(), isValidRef: async () => false })
    expect(codes(r.issues)).toEqual(['curriculum.invalid_ref', 'curriculum.invalid_ref'])
    expect(r.ok).toBe(false)
  })

  it('a failing validator is a warning, not a crash', async () => {
    const r = await validateArtifact(withRef(), {
      request: request(),
      isValidRef: async () => {
        throw new Error('db down')
      },
    })
    expect(r.ok).toBe(true)
    expect(codes(r.issues)).toContain('curriculum.unavailable')
  })

  it('is skipped without a validator or db', async () => {
    expect((await validateArtifact(withRef(), { request: request() })).checks).not.toContain('curriculum')
  })

  it('defaults to the real isValidRef when given a db', async () => {
    const h = await createTestDb()
    try {
      const r = await validateArtifact(withRef(), { request: request(), db: h.db })
      expect(r.checks).toContain('curriculum')
      expect(codes(r.issues)).toContain('curriculum.invalid_ref') // empty curriculum tables
    } finally {
      await h.close()
    }
  })
})

describe('validateItem', () => {
  it('validates a single item with the item checks', async () => {
    const r = await validateItem(item('numeric'), { request: request() })
    expect(r).toMatchObject({ ok: true, issues: [] })
    expect(r.checks).toEqual(['schema', 'answers', 'math', 'leakage', 'language', 'age', 'safety', 'grounding'])
  })
  it('reports schema problems with the item id', async () => {
    const r = await validateItem({ id: 'x1', kind: 'numeric', prompt: '' }, { request: request() })
    expect(r.ok).toBe(false)
    expect(r.issues.every((i) => i.code === 'schema.invalid' && i.itemId === 'x1')).toBe(true)
  })
  it('uses school and source mode overrides', async () => {
    const long = item('trueFalse', { prompt: 'Solen är en stjärna. '.repeat(10) })
    const early = await validateItem(long, { request: request() })
    expect(codes(early.issues)).toContain('age.prompt_too_long')
    const upper = await validateItem(long, { request: request(), school: { stage: 'gymnasieskola', year: 1 } })
    expect(codes(upper.issues)).not.toContain('age.prompt_too_long')
    const strict = await validateItem(item('trueFalse'), {
      request: request(),
      sourceMode: 'strict',
      material: MATERIAL,
    })
    expect(codes(strict.issues)).toEqual(['grounding.no_upload_source'])
  })
  it('flags missing material for a single item', async () => {
    const r = await validateItem(item('trueFalse', { sources: [upload('s1', 1)] }), {
      request: request({ sourceMode: 'strict' }),
    })
    expect(codes(r.issues)).toEqual(['grounding.material_missing'])
  })
})

describe('aiReview', () => {
  const a = () => artifact([item('trueFalse'), item('flashcard')])

  it('is off by default', async () => {
    expect((await validateArtifact(a(), { request: request() })).checks).not.toContain('aiReview')
  })

  it('turns model flags into warnings for known items only', async () => {
    let prompt = ''
    const text = mockText((req) => {
      prompt = req.messages[0]!.content
      return {
        flags: [
          { itemId: 'i-flashcard', problem: 'Huvudstaden är fel.' },
          { itemId: 'nope', problem: 'Hittat på.' },
        ],
      }
    })
    const r = await validateArtifact(a(), { request: request(), aiReview: { text } })
    expect(r.checks).toContain('aiReview')
    expect(r.ok).toBe(true) // never an error
    expect(r.issues).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'ai.possible_factual_error', itemId: 'i-flashcard' }),
    ])
    expect(prompt).toContain('Stockholm')
  })

  it('does not approve anything: programmatic errors stand', async () => {
    const text = mockText(() => ({ flags: [] }))
    const r = await validateArtifact(artifact([item('numeric', { answer: 1 })]), {
      request: request(),
      aiReview: { text },
    })
    expect(r.ok).toBe(false)
  })

  it('a failing model is a warning', async () => {
    const text = mockText(() => {
      throw new Error('boom')
    })
    const r = await validateArtifact(a(), { request: request(), aiReview: { text } })
    expect(r.ok).toBe(true)
    expect(codes(r.issues)).toEqual(['ai.review_unavailable'])
  })
})
