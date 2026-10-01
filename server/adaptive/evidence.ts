import type { ItemKind, SkillEvidence } from '../../shared/contracts'
import type { Db } from '../db/client'
import { skillEvidence, skillEvidenceKinds } from '../db/schema'

/**
 * Append answer evidence (one row per skill tag). Used by test runs and exercises.
 * Pass `itemKind` when known: the recall-vs-explanation detector needs it.
 */
export async function recordEvidence(db: Db, rows: (SkillEvidence & { itemKind?: ItemKind })[]) {
  if (!rows.length) return
  const ids = await db
    .insert(skillEvidence)
    .values(
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
    .returning({ id: skillEvidence.id })
  const kinds = rows.flatMap((e, i) => (e.itemKind ? [{ evidenceId: ids[i]!.id, itemKind: e.itemKind }] : []))
  if (kinds.length) await db.insert(skillEvidenceKinds).values(kinds)
}
