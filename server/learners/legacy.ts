import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from '../db/client'
import { legacyProgress, legacySkillProgress } from '../db/schema'

// Import of the old web app's localStorage['jackapp:v1'] (src/core/types.ts AppState v1).
// Raw payload kept losslessly (minus parentPin); per-skill progress normalized. See docs/platform/learners.md.

const count = z.number().int().min(0)

/** One SkillProgress entry. Mirrors the old loader: `level` is required, the rest tolerated missing. */
export const LegacySkillProgress = z.object({
  level: z.number().int().min(1).max(5),
  attempts: count.default(0),
  firstTry: count.default(0),
  hintsUsed: count.default(0),
  recent: z
    .array(z.unknown())
    .default([])
    .transform((r) => r.filter((o): o is string => o === 'first' || o === 'retry' || o === 'helped')),
  levelLocked: z.boolean().default(false),
  lastPracticed: z.number().positive().optional(),
})

/** AppState v1, structure-checked. Missing fields are fine; wrong types mean a corrupt payload. */
export const LegacyAppState = z.looseObject({
  version: z.literal(1),
  progress: z.record(z.string().max(60), z.unknown()).default({}),
  missions: z.record(z.string(), count).optional(),
  sessionCounter: count.optional(),
  recentQuestionIds: z.array(z.string()).optional(),
  sessions: z.array(z.looseObject({})).optional(),
  settings: z.looseObject({}).optional(),
  freePlay: z.looseObject({}).optional(),
})

export interface ImportResult {
  importId: string
  created: boolean
  skills: number
  /** Progress entries that could not be read (kept in the raw copy). */
  skipped: string[]
}

export async function importLegacy(db: Db, learnerId: string, body: unknown): Promise<ImportResult> {
  const parsed = LegacyAppState.parse(body)
  // The old plain 4-digit parentPin is never imported or stored (see docs/platform/gate.md).
  const { parentPin: _pin, ...data } = body as Record<string, unknown>
  const payloadHash = createHash('sha256').update(JSON.stringify(data)).digest('hex')

  const skills: (typeof legacySkillProgress.$inferInsert)[] = []
  const skipped: string[] = []
  for (const [skill, raw] of Object.entries(parsed.progress)) {
    const r = LegacySkillProgress.safeParse(raw)
    if (!r.success) {
      skipped.push(skill)
      continue
    }
    const p = r.data
    skills.push({
      learnerId,
      skill,
      importId: '',
      level: p.level,
      attempts: p.attempts,
      firstTry: p.firstTry,
      hintsUsed: p.hintsUsed,
      recent: p.recent,
      levelLocked: p.levelLocked,
      lastPracticedAt:
        p.lastPracticed && Number.isFinite(new Date(p.lastPracticed).getTime()) ? new Date(p.lastPracticed) : null,
    })
  }

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(legacyProgress)
      .values({ learnerId, version: parsed.version, payloadHash, data })
      .onConflictDoNothing()
      .returning({ id: legacyProgress.id })
    if (!row) {
      const [existing] = await tx
        .select({ id: legacyProgress.id })
        .from(legacyProgress)
        .where(and(eq(legacyProgress.learnerId, learnerId), eq(legacyProgress.payloadHash, payloadHash)))
      return { importId: existing!.id, created: false, skills: skills.length, skipped }
    }
    for (const s of skills) {
      s.importId = row.id
      const { learnerId: _l, skill: _s, ...set } = s
      await tx
        .insert(legacySkillProgress)
        .values(s)
        .onConflictDoUpdate({ target: [legacySkillProgress.learnerId, legacySkillProgress.skill], set })
    }
    return { importId: row.id, created: true, skills: skills.length, skipped }
  })
}
