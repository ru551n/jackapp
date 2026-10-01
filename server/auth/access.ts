import { and, eq } from 'drizzle-orm'
import type { LearnerRole } from '../../shared/contracts'
import type { Db } from '../db/client'
import { learnerAccess } from '../db/schema'

/** The adult's role for a learner, or null if they have no access. */
export async function roleFor(db: Db, userId: string, learnerId: string): Promise<LearnerRole | null> {
  const [row] = await db
    .select({ role: learnerAccess.role })
    .from(learnerAccess)
    .where(and(eq(learnerAccess.userId, userId), eq(learnerAccess.learnerId, learnerId)))
  return row?.role ?? null
}
