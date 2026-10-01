import { z } from 'zod'
import { MediaRef, SourceRef } from './provenance'
import { CurriculumRef, SchoolPosition, SubjectCode } from './school'
import { SupportPreferences } from './learner'

// Generated learning content as normal application data (never only raw model text).

const Base = z.object({
  id: z.string(),
  prompt: z.string().min(1).max(2000),
  /** Language of the prompt text (Swedish UI; English etc. when it is the subject). */
  lang: z.string().min(2).max(5).default('sv'),
  media: z.array(MediaRef).max(4).default([]),
  /** Progressive hints, shown one at a time after misses. */
  hints: z.array(z.string().max(500)).max(4).default([]),
  /** Shown after answering (or at the end of a test). */
  explanation: z.string().max(2000).optional(),
  difficulty: z.number().int().min(1).max(5),
  /** Skill tags for evidence tracking, e.g. "math.multiplication.tables-6-9". */
  skills: z.array(z.string().max(120)).min(1).max(6),
  sources: z.array(SourceRef).min(1),
  curriculumRefs: z.array(CurriculumRef).max(6).default([]),
})

const Choice = z.object({ id: z.string(), text: z.string().max(500), media: MediaRef.optional() })

export const Item = z.discriminatedUnion('kind', [
  Base.extend({ kind: z.literal('multipleChoice'), choices: z.array(Choice).min(2).max(6), answer: z.string() }),
  Base.extend({
    kind: z.literal('multiSelect'),
    choices: z.array(Choice).min(2).max(8),
    answers: z.array(z.string()).min(1),
  }),
  Base.extend({ kind: z.literal('trueFalse'), answer: z.boolean() }),
  Base.extend({
    kind: z.literal('fillBlank'),
    /** Text with "___" marking each blank, in order. */
    text: z.string().max(2000),
    blanks: z
      .array(z.object({ accepted: z.array(z.string().max(100)).min(1) }))
      .min(1)
      .max(10),
  }),
  Base.extend({
    kind: z.literal('matching'),
    pairs: z
      .array(z.object({ left: z.string().max(200), right: z.string().max(200) }))
      .min(2)
      .max(10),
  }),
  Base.extend({
    kind: z.literal('ordering'),
    items: z.array(Choice).min(2).max(10),
    answer: z.array(z.string()).min(2),
  }),
  Base.extend({
    kind: z.literal('numeric'),
    answer: z.number(),
    /** Accepted absolute tolerance. */
    tolerance: z.number().nonnegative().default(0),
    unit: z.string().max(30).optional(),
    /** Machine-checkable expression (e.g. "7*8" or "(3/4)*12") used to verify `answer`. */
    check: z.string().max(300).optional(),
  }),
  Base.extend({
    kind: z.literal('freeText'),
    /** Key points a good answer contains; used for AI-assisted assessment and self-check. */
    rubric: z.array(z.string().max(300)).min(1).max(8),
    sampleAnswer: z.string().max(2000).optional(),
  }),
  Base.extend({ kind: z.literal('flashcard'), back: z.string().max(1000) }),
])
export type Item = z.infer<typeof Item>
export type ItemKind = Item['kind']

export const SectionKind = z.enum(['intro', 'explanation', 'example', 'practice', 'recap', 'check', 'text', 'task'])

export const Section = z.object({
  kind: SectionKind,
  title: z.string().max(200).optional(),
  /** Simple markdown subset (paragraphs, lists, bold). */
  body: z.string().max(12000).optional(),
  media: z.array(MediaRef).max(6).default([]),
  items: z.array(Item).max(60).default([]),
})
export type Section = z.infer<typeof Section>

export const ArtifactType = z.enum([
  'practiceTest',
  'exercises',
  'lesson',
  'revision',
  'worksheet',
  'flashcards',
  'readingComprehension',
  'explanation',
  'summary',
  'story',
  'writingPrompt',
  'project',
])
export type ArtifactType = z.infer<typeof ArtifactType>

export const SourceMode = z.enum(['strict', 'sourceAndCurriculum', 'extended'])
export type SourceMode = z.infer<typeof SourceMode>

export const ApprovalState = z.enum(['draft', 'pendingApproval', 'approved', 'rejected'])
export type ApprovalState = z.infer<typeof ApprovalState>

/** Natural-language or form-driven request. Server resolves defaults from the learner profile. */
export const GenerationRequest = z.object({
  learnerId: z.string().uuid(),
  type: ArtifactType,
  subjectCode: SubjectCode.optional(),
  school: SchoolPosition.optional(),
  topic: z.string().max(300).optional(),
  curriculumRefs: z.array(CurriculumRef).max(10).default([]),
  studySetId: z.string().uuid().optional(),
  sourceMode: SourceMode.default('sourceAndCurriculum'),
  questionCount: z.number().int().min(1).max(60).optional(),
  itemKinds: z.array(z.string()).max(9).optional(),
  /** Practice tests: relative weight per item kind, e.g. { multipleChoice: 7, freeText: 3 }. Even split when absent. */
  kindMix: z.record(z.string(), z.number().min(0).max(100)).optional(),
  difficulty: z.number().int().min(1).max(5).optional(),
  durationMinutes: z.number().int().min(3).max(120).optional(),
  theme: z.string().max(100).optional(),
  support: SupportPreferences.partial().optional(),
  feedback: z.enum(['immediate', 'end']).default('immediate'),
  hints: z.boolean().default(true),
  includeImages: z.boolean().default(false),
  useWebResearch: z.boolean().default(false),
  /** Skill tags generated items must carry (e.g. from a learning path or remediation). */
  skills: z.array(z.string().max(120)).max(10).optional(),
  /** Free text from the adult or learner, e.g. "10 matteuppgifter om multiplikation med tåg". */
  instructions: z.string().max(2000).optional(),
})
export type GenerationRequest = z.infer<typeof GenerationRequest>

export const ValidationIssue = z.object({
  severity: z.enum(['error', 'warning']),
  code: z.string(),
  itemId: z.string().optional(),
  message: z.string(),
})
export type ValidationIssue = z.infer<typeof ValidationIssue>

export const ValidationReport = z.object({
  ok: z.boolean(),
  issues: z.array(ValidationIssue),
  /** Names of checks that ran, e.g. "schema", "answers", "math", "grounding", "language". */
  checks: z.array(z.string()),
  checkedAt: z.string(),
})
export type ValidationReport = z.infer<typeof ValidationReport>

export const Artifact = z.object({
  id: z.string().uuid(),
  learnerId: z.string().uuid(),
  type: ArtifactType,
  title: z.string().max(200),
  subjectCode: SubjectCode.optional(),
  school: SchoolPosition,
  sourceMode: SourceMode,
  studySetId: z.string().uuid().optional(),
  sections: z.array(Section).min(1),
  feedback: z.enum(['immediate', 'end']),
  approval: ApprovalState,
  validation: ValidationReport,
  /** Monotonic edit version; edits/regenerations create a new version. */
  version: z.number().int().min(1),
  createdBy: z.enum(['adult', 'learner', 'system']),
  createdAt: z.string(),
})
export type Artifact = z.infer<typeof Artifact>
