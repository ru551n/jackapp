import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { CurriculumRef, SegmentKind, StudySetStatus, StudySegment } from '../../../shared/contracts'
import { learners } from './core'

// Study material uploads and their processed representation (docs/platform/uploads.md).

const ts = (name: string) => timestamp(name, { withTimezone: true })

export const studySets = pgTable(
  'study_sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    learnerId: uuid('learner_id')
      .notNull()
      .references(() => learners.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    status: text('status').$type<StudySetStatus>().notNull(),
    /** Safe Swedish failure reason (status = failed). */
    failure: text('failure'),
    /** Latest study.process job. */
    jobId: uuid('job_id'),
    /** Start of the failed-originals retention window. */
    failedAt: ts('failed_at'),
    /** Originals removed (after success, cleanup or delete); reprocess is no longer possible. */
    sourcesDeletedAt: ts('sources_deleted_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('study_sets_learner_idx').on(t.learnerId, t.createdAt), index('study_sets_status_idx').on(t.status)],
)

/** One page of a set: an image file, or one page of an uploaded PDF. */
export const studyPages = pgTable(
  'study_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    setId: uuid('set_id')
      .notNull()
      .references(() => studySets.id, { onDelete: 'cascade' }),
    /** 1-based order within the set. */
    page: integer('page').notNull(),
    /** File name inside DATA_DIR/uploads/<setId>/. */
    file: text('file').notNull(),
    mimeType: text('mime_type').notNull(),
    /** Size of the uploaded source file. */
    bytes: integer('bytes').notNull(),
    /** sha256 of the uploaded source file (the extraction cache key with pdfPage). */
    sha256: text('sha256').notNull(),
    pdfPage: integer('pdf_page'),
    sourceDeleted: boolean('source_deleted').notNull().default(false),
  },
  (t) => [index('study_pages_set_idx').on(t.setId, t.page), index('study_pages_sha_idx').on(t.sha256)],
)

/** Vision output per source page, so unchanged pages are never sent to vision twice. */
export const studyPageExtractions = pgTable(
  'study_page_extractions',
  {
    sha256: text('sha256').notNull(),
    /** PDF page number, 0 for images. */
    pdfPage: integer('pdf_page').notNull(),
    segments: jsonb('segments').$type<Omit<StudySegment, 'id' | 'page'>[]>().notNull(),
    model: text('model').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.sha256, t.pdfPage] })],
)

export interface StudyProvenance {
  method: 'vision' | 'text-layer'
  visionModel?: string
  textModel: string
  pages: number
  cachedPages: number
}

export const studyMaterials = pgTable('study_materials', {
  setId: uuid('set_id')
    .primaryKey()
    .references(() => studySets.id, { onDelete: 'cascade' }),
  language: text('language').notNull(),
  subjectGuess: text('subject_guess'),
  topic: text('topic').notNull(),
  summary: text('summary').notNull(),
  concepts: jsonb('concepts').$type<string[]>().notNull(),
  curriculumRefs: jsonb('curriculum_refs').$type<CurriculumRef[]>().notNull(),
  /** Adult-only technical provenance (models, method). */
  provenance: jsonb('provenance').$type<StudyProvenance>().notNull(),
  processedAt: ts('processed_at').notNull(),
})

/** Extracted segments. `id` ("p<page>s<n>") is stable once the set is ready (originals are gone). */
export const studySegments = pgTable(
  'study_segments',
  {
    setId: uuid('set_id')
      .notNull()
      .references(() => studySets.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    page: integer('page').notNull(),
    ord: integer('ord').notNull(),
    kind: text('kind').$type<SegmentKind>().notNull(),
    text: text('text').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>(),
    confidence: text('confidence').$type<StudySegment['confidence']>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.setId, t.id] }), index('study_segments_order_idx').on(t.setId, t.ord)],
)
