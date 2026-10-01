import type { SkillEvidence } from '../../shared/contracts'
import type { Db } from '../db/client'
import { skillEvidence } from '../db/schema'

/** Append answer evidence (one row per skill tag). Used by test runs and exercises. */
export async function recordEvidence(db: Db, rows: SkillEvidence[]) {
  if (!rows.length) return
  await db.insert(skillEvidence).values(
    rows.map((e) => ({
      learnerId: e.learnerId,
      skill: e.skill,
      subjectCode: e.subjectCode,
      artifactId: e.artifactId,
      itemId: e.itemId,
      correct: e.correct,
      misses: e.misses,
      hintsUsed: e.hintsUsed,
      difficulty: e.difficulty,
      at: new Date(e.at),
    })),
  )
}
