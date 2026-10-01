import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import type {
  ApprovalState,
  Artifact,
  ArtifactType,
  GenerationRequest,
  SchoolPosition,
  SourceMode,
  ValidationReport,
} from '../../../shared/contracts'
import { learners } from './core'

// Generation domain: artifacts and their immutable versions (docs/platform/generation.md).

export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    learnerId: uuid('learner_id')
      .notNull()
      .references(() => learners.id, { onDelete: 'cascade' }),
    type: text('type').$type<ArtifactType>().notNull(),
    title: text('title').notNull(),
    subjectCode: text('subject_code'),
    school: jsonb('school').$type<SchoolPosition>().notNull(),
    sourceMode: text('source_mode').$type<SourceMode>().notNull(),
    studySetId: uuid('study_set_id'),
    feedback: text('feedback').$type<'immediate' | 'end'>().notNull(),
    approval: text('approval').$type<ApprovalState>().notNull(),
    currentVersion: integer('current_version').notNull().default(1),
    createdBy: text('created_by').$type<'adult' | 'learner' | 'system'>().notNull(),
    /** The resolved GenerationRequest the artifact was generated from. */
    request: jsonb('request').$type<GenerationRequest>().notNull(),
    jobId: uuid('job_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // One artifact per generate job: a retried job finds and reuses it.
  (t) => [index('artifacts_learner_idx').on(t.learnerId, t.createdAt), uniqueIndex('artifacts_job_idx').on(t.jobId)],
)

export interface MaterialTruncation {
  pagesUsed: number[]
  segmentsUsed: number
  segmentsTotal: number
  pageRange?: [number, number]
}

/** Requested (not yet generated) illustration for an item; filled by the image domain. */
export interface IllustrationRequest {
  itemId: string
  description: string
  /** Short search term for licensed images (fallback when image generation is off). */
  query?: string
  /** Set for a picture on one answer choice (index into item.choices). */
  choice?: number
}

export const artifactVersions = pgTable(
  'artifact_versions',
  {
    artifactId: uuid('artifact_id')
      .notNull()
      .references(() => artifacts.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    /** Full contract-validated Artifact at this version. */
    content: jsonb('content').$type<Artifact>().notNull(),
    validation: jsonb('validation').$type<ValidationReport>().notNull(),
    illustrations: jsonb('illustrations').$type<IllustrationRequest[]>().notNull().default([]),
    /** How it was made: 'generate' | 'transform:<kind>' | 'regenerateItem' | 'edit'. */
    origin: text('origin').notNull(),
    // Server-only metadata; never sent to clients.
    model: text('model'),
    providerKind: text('provider_kind'),
    promptVersion: text('prompt_version'),
    /** Set when not all study material fit the prompt: which pages/segments were used. */
    truncated: jsonb('truncated').$type<MaterialTruncation>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.artifactId, t.version] })],
)
