import { asc, eq } from 'drizzle-orm'
import type { ProcessedStudyMaterial } from '../../shared/contracts'
import type { Db } from '../db/client'
import { studyMaterials, studySegments, studySets } from '../db/schema'

/** The processed representation of a ready study set (reused by every generation; no re-run of vision). */
export async function loadProcessedMaterial(db: Db, setId: string) {
  const [set] = await db.select().from(studySets).where(eq(studySets.id, setId))
  const [m] = await db.select().from(studyMaterials).where(eq(studyMaterials.setId, setId))
  if (!set || set.status !== 'ready' || !m) return undefined
  const segments = await db
    .select()
    .from(studySegments)
    .where(eq(studySegments.setId, setId))
    .orderBy(asc(studySegments.ord))
  const material: ProcessedStudyMaterial = {
    studySetId: setId,
    language: m.language,
    ...(m.subjectGuess ? { subjectGuess: m.subjectGuess } : {}),
    topic: m.topic,
    summary: m.summary,
    concepts: m.concepts,
    curriculumRefs: m.curriculumRefs,
    segments: segments.map((s) => ({
      id: s.id,
      page: s.page,
      kind: s.kind,
      text: s.text,
      ...(s.data ? { data: s.data } : {}),
      confidence: s.confidence,
    })),
    processedAt: m.processedAt.toISOString(),
  }
  return { material, provenance: m.provenance, learnerId: set.learnerId }
}
