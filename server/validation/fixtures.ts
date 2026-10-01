import type { z } from 'zod'
import { Artifact, GenerationRequest, Item, ProcessedStudyMaterial } from '../../shared/contracts'
import type { CheckContext } from './checks'

// Test fixtures for server/validation (imported by *.test.ts only).

export const LEARNER = '00000000-0000-4000-8000-000000000001'
export const SET = '00000000-0000-4000-8000-000000000002'
export const MODEL_SRC = { kind: 'model', capability: 'text' } as const

const GOOD: Record<Item['kind'], Record<string, unknown>> = {
  multipleChoice: {
    prompt: 'Vilket djur säger mjau?',
    choices: [
      { id: 'a', text: 'Katt' },
      { id: 'b', text: 'Hund' },
      { id: 'c', text: 'Ko' },
    ],
    answer: 'a',
  },
  multiSelect: {
    prompt: 'Vilka är frukter?',
    choices: [
      { id: 'a', text: 'Äpple' },
      { id: 'b', text: 'Morot' },
      { id: 'c', text: 'Banan' },
    ],
    answers: ['a', 'c'],
  },
  trueFalse: { prompt: 'Solen är en stjärna.', answer: true },
  fillBlank: { prompt: 'Fyll i ordet som saknas.', text: 'Katten ___ på mattan.', blanks: [{ accepted: ['sitter'] }] },
  matching: {
    prompt: 'Para ihop djuret med ljudet.',
    pairs: [
      { left: 'Katt', right: 'mjau' },
      { left: 'Hund', right: 'voff' },
    ],
  },
  ordering: {
    prompt: 'Sätt talen i ordning från minst till störst.',
    items: [
      { id: 'a', text: '3' },
      { id: 'b', text: '1' },
      { id: 'c', text: '2' },
    ],
    answer: ['b', 'c', 'a'],
  },
  numeric: { prompt: 'Vad är 7 × 8?', answer: 56, check: '7*8' },
  freeText: { prompt: 'Berätta om din favoritfrukt.', rubric: ['Nämner en frukt'] },
  flashcard: { prompt: 'Vad heter huvudstaden i Sverige?', back: 'Stockholm' },
}

export const KINDS = Object.keys(GOOD) as Item['kind'][]

/** A valid item of `kind`, with overrides (parsed through the contract). */
export function item(kind: Item['kind'], over: Record<string, unknown> = {}): Item {
  return Item.parse({
    id: `i-${kind}`,
    kind,
    difficulty: 1,
    skills: ['test'],
    sources: [MODEL_SRC],
    ...GOOD[kind],
    ...over,
  })
}

export function request(over: Partial<z.input<typeof GenerationRequest>> = {}): GenerationRequest {
  return GenerationRequest.parse({
    learnerId: LEARNER,
    type: 'exercises',
    school: { stage: 'grundskola', year: 2 },
    ...over,
  })
}

export function artifact(items: Item[], over: Partial<z.input<typeof Artifact>> = {}): Artifact {
  return Artifact.parse({
    id: '00000000-0000-4000-8000-000000000003',
    learnerId: LEARNER,
    type: 'exercises',
    title: 'Övningar',
    school: { stage: 'grundskola', year: 2 },
    sourceMode: 'sourceAndCurriculum',
    sections: [{ kind: 'practice', items }],
    feedback: 'immediate',
    approval: 'draft',
    validation: { ok: true, issues: [], checks: [], checkedAt: '2026-10-01T00:00:00Z' },
    version: 1,
    createdBy: 'system',
    createdAt: '2026-10-01T00:00:00Z',
    ...over,
  })
}

export const MATERIAL: ProcessedStudyMaterial = ProcessedStudyMaterial.parse({
  studySetId: SET,
  language: 'sv',
  topic: 'Vattnets kretslopp',
  summary: 'Hur vatten avdunstar, bildar moln och faller som regn.',
  concepts: ['avdunstning', 'kondensation'],
  curriculumRefs: [],
  segments: [
    {
      id: 's1',
      page: 1,
      kind: 'text',
      text: 'Vattnets kretslopp: Solen värmer vattnet i havet. Vattnet avdunstar och blir vattenånga.',
      confidence: 'high',
    },
    {
      id: 's2',
      page: 1,
      kind: 'definition',
      text: 'Avdunstning betyder att vatten blir till gas.',
      confidence: 'high',
    },
    {
      id: 's3',
      page: 2,
      kind: 'text',
      text: 'Vattenångan kyls av och bildar moln. Sedan faller regn.',
      confidence: 'medium',
    },
  ],
  processedAt: '2026-10-01T00:00:00Z',
})

export const upload = (segmentId: string, page: number, excerpt?: string, studySetId = SET) => ({
  kind: 'upload' as const,
  studySetId,
  page,
  segmentId,
  ...(excerpt !== undefined && { excerpt }),
})

export function ctx(over: Partial<CheckContext> = {}): CheckContext {
  return { request: request(), band: 'early', sourceMode: 'sourceAndCurriculum', ...over }
}

/** Issue codes, for compact assertions. */
export const codes = (issues: { code: string }[]) => issues.map((i) => i.code)
