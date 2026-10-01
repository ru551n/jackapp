import { areaById } from '../core/catalog'
import { createRng, hashSeed } from '../core/rng'
import type { AppState, AreaId, Generator, Level, Question, SkillId } from '../core/types'
import { newSkillProgress, supportFor } from './adaptation'

export const SESSION_LENGTH = 4
const MAX_REROLLS = 8

/**
 * Pick the two least-recently practised skills in the area (never-practised first, catalog
 * order as tie-break) and alternate them A, A, B, B. Predictable and covers every skill over time.
 */
export function planSession(area: AreaId, state: AppState, available: SkillId[]): SkillId[] {
  const info = areaById(area)
  if (!info) throw new Error(`Unknown area ${area}`)
  const skills = info.skills.filter((s) => available.includes(s))
  if (skills.length === 0) return []
  const ranked = [...skills].sort(
    (a, b) => (state.progress[a]?.lastPracticed ?? -1) - (state.progress[b]?.lastPracticed ?? -1),
  )
  const [a, b = a] = ranked
  const half = Math.ceil(SESSION_LENGTH / 2)
  return Array.from({ length: SESSION_LENGTH }, (_, i) => (i < half ? a : b))
}

/** Generators for this level; if none cover it, the ones closest to it. */
export function generatorsFor(all: Generator[], skill: SkillId, level: Level): Generator[] {
  const forSkill = all.filter((g) => g.skill === skill)
  const fit = forSkill.filter((g) => g.levels[0] <= level && level <= g.levels[1])
  if (fit.length) return fit
  const dist = (g: Generator) => Math.min(Math.abs(g.levels[0] - level), Math.abs(g.levels[1] - level))
  const best = Math.min(...forSkill.map(dist))
  return forSkill.filter((g) => dist(g) === best)
}

/** Deterministic next question; rerolls the seed to avoid recently seen questions. */
export function nextQuestion(
  all: Generator[],
  skill: SkillId,
  state: AppState,
  seed: number,
  avoid: readonly string[],
): Question {
  const progress = state.progress[skill] ?? newSkillProgress()
  const gens = generatorsFor(all, skill, progress.level)
  if (!gens.length) throw new Error(`No generator for ${skill}`)
  const support = supportFor(progress)
  let q: Question | undefined
  for (let i = 0; i < MAX_REROLLS; i++) {
    const rng = createRng(hashSeed(seed, skill, i))
    q = rng.pick(gens).generate({ rng, level: progress.level, support })
    if (!avoid.includes(q.id)) return q
  }
  return q!
}
