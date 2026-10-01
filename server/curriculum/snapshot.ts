import { readdirSync, readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { z } from 'zod'
import { SchoolStage, SubjectCode } from '../../shared/contracts'

// Typed, versioned curriculum snapshot imported from Skolverket (see docs/platform/curriculum.md).

export const ItemKind = z.enum(['central_content', 'knowledge_requirement', 'goal'])
export type ItemKind = z.infer<typeof ItemKind>

export const SnapshotItem = z.object({
  /** Stable across snapshots while the text is unchanged: `<subject>:<span>:<kind>:<hash>`. */
  id: z.string().min(1),
  kind: ItemKind,
  /** "1-3"/"4-6"/"7-9"/"4-9" (grundskola), "F" (förskoleklass), a course/level code (gymnasieskola); absent = whole subject. */
  span: z.string().optional(),
  /** h3 sub-heading in the source, e.g. "I årskurs 4–6, inom ramen för språkval". */
  section: z.string().optional(),
  /** Content area heading, e.g. "Taluppfattning och tals användning". */
  area: z.string().optional(),
  /** Grade step (E–A) for knowledge requirements. */
  gradeStep: z.string().optional(),
  text: z.string().min(1),
})
export type SnapshotItem = z.infer<typeof SnapshotItem>

export const SnapshotCourse = z.object({ code: z.string(), name: z.string(), points: z.string().optional() })

export const SnapshotSubject = z.object({
  code: SubjectCode,
  name: z.string().min(1),
  stage: SchoolStage,
  applicableYears: z.array(z.number().int().min(0).max(9)).min(1),
  /** Skolverket syllabus type, e.g. COURSE_SYLLABUS, SUBJECT_SYLLABUS (GY11 courses), GRADE_SUBJECT_SYLLABUS (GY25 levels). */
  syllabusType: z.string(),
  /** Gymnasium reform: GY11 (courses) or GY25 (subjects with levels). */
  reform: z.string().optional(),
  categories: z.array(z.string()).default([]),
  schoolTypes: z.array(z.string()),
  validFrom: z.string().optional(),
  validUntil: z.string().optional(),
  /** Skolverket's own version number of this syllabus. */
  sourceVersion: z.number().int().optional(),
  purpose: z.string(),
  courses: z.array(SnapshotCourse).default([]),
  sourceUrl: z.string().url(),
  items: z.array(SnapshotItem),
})
export type SnapshotSubject = z.infer<typeof SnapshotSubject>

export const CurriculumSnapshot = z.object({
  source: z.literal('skolverket'),
  /** Snapshot version = retrieval date, YYYY-MM-DD. Used as CurriculumRef.version. */
  version: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  retrievedAt: z.string().datetime({ offset: true }),
  apiVersion: z.string(),
  licence: z.string(),
  sourceUrls: z.array(z.string().url()).min(1),
  subjects: z.array(SnapshotSubject).min(1),
})
export type CurriculumSnapshot = z.infer<typeof CurriculumSnapshot>

export const DATA_DIR = new URL('./data/', import.meta.url)

/** Newest committed snapshot (`data/skolverket-YYYY-MM-DD.json.gz`), validated. */
export function loadBundledSnapshot(): CurriculumSnapshot {
  const file = readdirSync(DATA_DIR)
    .filter((f) => /^skolverket-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(f))
    .sort()
    .at(-1)
  if (!file) throw new Error('no bundled curriculum snapshot')
  return CurriculumSnapshot.parse(JSON.parse(gunzipSync(readFileSync(new URL(file, DATA_DIR))).toString('utf8')))
}
