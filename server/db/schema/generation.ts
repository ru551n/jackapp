import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
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
  (t) => [index('artifacts_learner_idx').on(t.learnerId, t.createdAt)],
)

/** Requested (not yet generated) illustration for an item; filled by the image domain. */
export interface IllustrationRequest {
  itemId: string
  description: string
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.artifactId, t.version] })],
)
