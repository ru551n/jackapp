import { z } from 'zod'
import { CurriculumRef, SubjectCode } from './school'

// Uploaded study material. Original binaries are temporary: once processing has committed the
// structured representation below, the upload files are deleted (docs/platform/uploads.md).

export const StudySetStatus = z.enum(['uploading', 'queued', 'processing', 'ready', 'failed'])
export type StudySetStatus = z.infer<typeof StudySetStatus>

export const StudyPageInfo = z.object({
  /** 1-based position; order is as uploaded (or as reordered by the adult before processing). */
  page: z.number().int().min(1),
  mimeType: z.string(),
  bytes: z.number().int().nonnegative(),
  /** Pages coming from a PDF keep their PDF page number for traceability. */
  pdfPage: z.number().int().min(1).optional(),
  /** True once the original binary has been deleted after successful processing. */
  sourceDeleted: z.boolean(),
})
export type StudyPageInfo = z.infer<typeof StudyPageInfo>

export const SegmentKind = z.enum([
  'heading',
  'text',
  'definition',
  'vocabulary',
  'formula',
  'example',
  'question',
  'list',
  'table',
  'diagram',
  'map',
  'image',
  'handwriting',
])
export type SegmentKind = z.infer<typeof SegmentKind>

/** One extracted piece of knowledge, traceable to its page. */
export const StudySegment = z.object({
  id: z.string(),
  page: z.number().int().min(1),
  kind: SegmentKind,
  /** Faithful transcription or, for diagrams/images, a precise description. */
  text: z.string().max(8000),
  /** Structured extras, e.g. vocabulary pairs, table rows, formula in LaTeX. */
  data: z.record(z.string(), z.unknown()).optional(),
  /** Model's confidence in the reading of this segment. */
  confidence: z.enum(['high', 'medium', 'low']),
})
export type StudySegment = z.infer<typeof StudySegment>

/** The reusable representation every later generation works from (no re-running vision). */
export const ProcessedStudyMaterial = z.object({
  studySetId: z.string().uuid(),
  /** Main language of the material (ISO 639-1). */
  language: z.string().min(2).max(5),
  subjectGuess: SubjectCode.optional(),
  topic: z.string().max(200),
  summary: z.string().max(2000),
  /** Key concepts/skills the material teaches, used as skill tags. */
  concepts: z.array(z.string().max(120)).max(60),
  curriculumRefs: z.array(CurriculumRef).max(20),
  segments: z.array(StudySegment).min(1),
  /** Processing metadata (model ids are server-side only and not sent to learners). */
  processedAt: z.string(),
})
export type ProcessedStudyMaterial = z.infer<typeof ProcessedStudyMaterial>

export const StudySet = z.object({
  id: z.string().uuid(),
  learnerId: z.string().uuid(),
  title: z.string().max(200),
  status: StudySetStatus,
  pages: z.array(StudyPageInfo),
  createdAt: z.string(),
  /** Safe, user-facing failure reason when status = failed. */
  failure: z.string().max(500).optional(),
})
export type StudySet = z.infer<typeof StudySet>
