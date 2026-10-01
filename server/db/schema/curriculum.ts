import { boolean, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

// Official curriculum imported from Skolverket (server/curriculum). Rows are never AI-written.

export const curriculumVersions = pgTable('curriculum_versions', {
  /** Snapshot version (retrieval date), used as CurriculumRef.version. */
  version: text('version').primaryKey(),
  source: text('source').notNull(),
  retrievedAt: timestamp('retrieved_at', { withTimezone: true }).notNull(),
  apiVersion: text('api_version').notNull(),
  licence: text('licence').notNull(),
  sourceUrls: jsonb('source_urls').$type<string[]>().notNull(),
  /** sha256 of the snapshot JSON: a re-sync of the same version with different content replaces it. */
  contentHash: text('content_hash').notNull(),
  active: boolean('active').notNull().default(false),
  importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
})

export const curriculumSubjects = pgTable(
  'curriculum_subjects',
  {
    version: text('version')
      .notNull()
      .references(() => curriculumVersions.version, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    stage: text('stage').notNull(),
    applicableYears: jsonb('applicable_years').$type<number[]>().notNull(),
    syllabusType: text('syllabus_type').notNull(),
    reform: text('reform'),
    categories: jsonb('categories').$type<string[]>().notNull(),
    schoolTypes: jsonb('school_types').$type<string[]>().notNull(),
    validFrom: text('valid_from'),
    validUntil: text('valid_until'),
    sourceVersion: integer('source_version'),
    purpose: text('purpose').notNull(),
    courses: jsonb('courses').$type<{ code: string; name: string; points?: string }[]>().notNull(),
    sourceUrl: text('source_url').notNull(),
  },
  (t) => [primaryKey({ columns: [t.version, t.code] }), index('curriculum_subjects_stage_idx').on(t.version, t.stage)],
)

export const curriculumItems = pgTable(
  'curriculum_items',
  {
    version: text('version').notNull(),
    id: text('id').notNull(),
    subjectCode: text('subject_code').notNull(),
    kind: text('kind').notNull(),
    span: text('span'),
    section: text('section'),
    area: text('area'),
    gradeStep: text('grade_step'),
    text: text('text').notNull(),
    /** Order within the subject, as in the source. */
    position: integer('position').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.version, t.id] }),
    foreignKey({
      columns: [t.version, t.subjectCode],
      foreignColumns: [curriculumSubjects.version, curriculumSubjects.code],
    }).onDelete('cascade'),
    index('curriculum_items_subject_idx').on(t.version, t.subjectCode),
  ],
)
