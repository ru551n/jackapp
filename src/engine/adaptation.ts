import { MAX_LEVEL, MIN_LEVEL } from '../core/types'
import type { Level, Outcome, SkillProgress, Support } from '../core/types'

// Deterministic, explainable adaptation. See docs/adaptive-difficulty.md.
export const RECENT_WINDOW = 6
export const LEVEL_UP_STREAK = 4 // this many first-try answers in a row → level +1
export const LEVEL_DOWN_WINDOW = 3 // among the last 3 answers ...
export const LEVEL_DOWN_HELPED = 2 // ... this many needed strong help → level −1

export const newSkillProgress = (level: Level = MIN_LEVEL): SkillProgress => ({
  level,
  attempts: 0,
  firstTry: 0,
  hintsUsed: 0,
  recent: [],
})

export const outcomeFromMisses = (misses: number): Outcome =>
  misses === 0 ? 'first' : misses === 1 ? 'retry' : 'helped'

const clampLevel = (n: number): Level => Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, n)) as Level

export function applyOutcome(p: SkillProgress, outcome: Outcome, hintsShown: number, now: number): SkillProgress {
  const recent = [...p.recent, outcome].slice(-RECENT_WINDOW)
  const next: SkillProgress = {
    ...p,
    attempts: p.attempts + 1,
    firstTry: p.firstTry + (outcome === 'first' ? 1 : 0),
    hintsUsed: p.hintsUsed + hintsShown,
    recent,
    lastPracticed: now,
  }
  if (p.levelLocked) return next

  const tail = recent.slice(-LEVEL_UP_STREAK)
  if (tail.length === LEVEL_UP_STREAK && tail.every((o) => o === 'first') && p.level < MAX_LEVEL) {
    return { ...next, level: clampLevel(p.level + 1), recent: [] }
  }
  const helped = recent.slice(-LEVEL_DOWN_WINDOW).filter((o) => o === 'helped').length
  if (helped >= LEVEL_DOWN_HELPED && p.level > MIN_LEVEL) {
    return { ...next, level: clampLevel(p.level - 1), recent: [] }
  }
  return next
}

/** Extra visual support after a hard question, or when most recent answers needed retries. */
export function supportFor(p: SkillProgress | undefined): Support {
  if (!p || p.recent.length === 0) return 'normal'
  if (p.recent[p.recent.length - 1] === 'helped') return 'extra'
  const last3 = p.recent.slice(-3)
  return last3.length === 3 && last3.filter((o) => o !== 'first').length >= 2 ? 'extra' : 'normal'
}

export type Trend = 'new' | 'easy' | 'ok' | 'hard'

/** Simplified status for the parent dashboard. */
export function trendOf(p: SkillProgress | undefined): Trend {
  if (!p || p.attempts === 0) return 'new'
  const r = p.recent
  if (r.length === 0) return 'ok' // level just changed
  const first = r.filter((o) => o === 'first').length
  const helped = r.filter((o) => o === 'helped').length
  if (helped * 3 >= r.length) return 'hard'
  if (first * 4 >= r.length * 3) return 'easy'
  return 'ok'
}

export const setLevel = (p: SkillProgress, level: Level, locked: boolean): SkillProgress => ({
  ...p,
  level,
  levelLocked: locked,
  recent: [],
})
