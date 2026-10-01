import { z } from 'zod'

// Swedish school structure. Curriculum content itself lives in the curriculum store (Skolverket
// sources), never here: these are only the coordinates used to address it.

export const SchoolStage = z.enum(['forskoleklass', 'grundskola', 'gymnasieskola'])
export type SchoolStage = z.infer<typeof SchoolStage>

/** Förskoleklass = 0, grundskola 1–9, gymnasieskola 1–3 (programme year). */
export const SchoolYear = z.number().int().min(0).max(9)

export const SchoolPosition = z
  .object({ stage: SchoolStage, year: SchoolYear })
  .refine(
    (p) =>
      p.stage === 'forskoleklass' ? p.year === 0 : p.stage === 'grundskola' ? p.year >= 1 : p.year <= 3 && p.year >= 1,
    {
      message: 'year does not fit stage',
    },
  )
export type SchoolPosition = z.infer<typeof SchoolPosition>

/** Drives the UX family, not the academic level. */
export const AgeBand = z.enum(['early', 'middle', 'upper'])
export type AgeBand = z.infer<typeof AgeBand>

export function ageBand(p: SchoolPosition): AgeBand {
  if (p.stage === 'gymnasieskola') return 'upper'
  if (p.stage === 'forskoleklass' || p.year <= 3) return 'early'
  return 'middle'
}

/**
 * Subject code as used by the curriculum source (e.g. Skolverket subject code "GRGRMAT01" or a
 * gymnasium subject "MAT"). Kept opaque: the curriculum module resolves names and content.
 */
export const SubjectCode = z.string().min(2).max(32)
export type SubjectCode = z.infer<typeof SubjectCode>

/** A pointer into versioned, source-attributed curriculum data. */
export const CurriculumRef = z.object({
  source: z.literal('skolverket'),
  /** Version/date stamp of the imported curriculum snapshot. */
  version: z.string(),
  subjectCode: SubjectCode,
  stage: SchoolStage,
  /** Skolverket year span for central content, e.g. "1-3", "4-6", "7-9"; or a course code for gymnasium. */
  span: z.string().optional(),
  /** Stable id of a central-content item or knowledge requirement within the snapshot. */
  itemId: z.string().optional(),
})
export type CurriculumRef = z.infer<typeof CurriculumRef>
