import { useSyncExternalStore } from 'react'
import type { AppState, FreeLine, Level, SessionLog, Settings, SkillId } from '../core/types'
import { applyOutcome, newSkillProgress, outcomeFromMisses, setLevel } from '../engine/adaptation'
import { defaultState, loadState, saveState } from './state'

const RECENT_IDS = 40
const SESSION_LOG = 50

let state: AppState = loadState()
const listeners = new Set<() => void>()

function set(update: (s: AppState) => AppState) {
  state = update(state)
  saveState(state)
  listeners.forEach((l) => l())
}

export const getState = () => state

export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useAppState<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state))
}

export const actions = {
  recordAnswer(skill: SkillId, questionId: string, misses: number, hintsShown: number) {
    set((s) => ({
      ...s,
      progress: {
        ...s.progress,
        [skill]: applyOutcome(
          s.progress[skill] ?? newSkillProgress(),
          outcomeFromMisses(misses),
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
