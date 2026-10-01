import { useSyncExternalStore } from 'react'
import type { AppState, AreaId, FreeLine, Level, SessionLog, Settings, SkillId } from '../core/types'
import { applyOutcome, newSkillProgress, outcomeFromMisses, setLevel } from '../engine/adaptation'
import { defaultState, learnerKey, loadState, saveState } from './state'

const RECENT_IDS = 40
const SESSION_LOG = 50

// The store holds the active learner's local progress. Until a learner is selected it is an
// in-memory default that is never persisted (so nothing can overwrite the legacy key).
let key: string | undefined
let state: AppState = defaultState()
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

function set(update: (s: AppState) => AppState) {
  state = update(state)
  if (key) saveState(state, key)
  notify()
}

export const getState = () => state
/** The active learner's storage key (re-renders when a learner is selected). */
export const useSelectedKey = () => useSyncExternalStore(subscribe, () => key)

/** Switch the store to a learner's progress (`jackapp:v1:<learnerId>`), or back to an unsaved default. */
export function selectLearner(learnerId: string | undefined) {
  const next = learnerId ? learnerKey(learnerId) : undefined
  if (next === key) return
  key = next
  state = key ? loadState(undefined, key) : defaultState()
  notify()
}

export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useAppState<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state))
}

export const actions = {
  /** `options`: how many answer options the question had (affects what counts as "needed help"). */
  recordAnswer(skill: SkillId, questionId: string, misses: number, hintsShown: number, options = 3) {
    set((s) => ({
      ...s,
      progress: {
        ...s.progress,
        [skill]: applyOutcome(
          s.progress[skill] ?? newSkillProgress(),
          outcomeFromMisses(misses, options),
          hintsShown,
          Date.now(),
        ),
      },
      recentQuestionIds: [...s.recentQuestionIds, questionId].slice(-RECENT_IDS),
    }))
  },

  completeSession(log: SessionLog) {
    set((s) => ({
      ...s,
      missions: { ...s.missions, [log.area]: s.missions[log.area] + 1 },
      sessionCounter: s.sessionCounter + 1,
      sessions: [...s.sessions, log].slice(-SESSION_LOG),
    }))
  },

  /** AI material ("uppdrag") finished: counts as one mission in `area`, so unlock rules stay the same. */
  addMission(area: AreaId) {
    set((s) => ({ ...s, missions: { ...s.missions, [area]: s.missions[area] + 1 } }))
  },

  /**
   * Take over migrated legacy progress: keeps this learner's (server-derived) settings, except that free
   * play stays on if a parent had enabled it (the server profile does not expose it). Drops the old PIN.
   */
  adoptLegacy(legacy: AppState) {
    set((s) => ({
      ...legacy,
      settings: { ...s.settings, freePlayEnabled: s.settings.freePlayEnabled || legacy.settings.freePlayEnabled },
      parentPin: undefined,
    }))
  },

  updateSettings(patch: Partial<Settings>) {
    set((s) => ({ ...s, settings: { ...s.settings, ...patch } }))
  },

  setParentPin(pin: string) {
    set((s) => ({ ...s, parentPin: pin }))
  },

  setSkillLevel(skill: SkillId, level: Level, locked: boolean) {
    set((s) => ({
      ...s,
      progress: { ...s.progress, [skill]: setLevel(s.progress[skill] ?? newSkillProgress(), level, locked) },
    }))
  },

  setFreeLine(line: FreeLine | null) {
    set((s) => ({ ...s, freePlay: { line } }))
  },

  /** Clears learning progress and collection; keeps settings and PIN. */
  resetProgress() {
    set((s) => ({ ...defaultState(), settings: s.settings, parentPin: s.parentPin }))
  },

  /** Test helper. */
  _replace(next: AppState) {
    set(() => next)
  },
}
