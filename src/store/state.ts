import type { AppState } from '../core/types'

export const STORAGE_KEY = 'jackapp:v1'

export const defaultState = (): AppState => ({
  version: 1,
  progress: {},
  missions: { stationen: 0, tunnelbanan: 0, sparvagnen: 0, flygplatsen: 0, engelska: 0 },
  sessionCounter: 0,
  recentQuestionIds: [],
  sessions: [],
  settings: { sound: false, speech: true, motion: 'system', freePlayEnabled: false },
  freePlay: { line: null },
})

/** Load from localStorage, falling back to defaults on missing/corrupt data. */
export function loadState(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): AppState {
  const base = defaultState()
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    if (!raw) return base
    const parsed = JSON.parse(raw) as Partial<AppState>
    if (parsed?.version !== 1) return base
    return {
      ...base,
      ...parsed,
      missions: { ...base.missions, ...parsed.missions },
      settings: { ...base.settings, ...parsed.settings },
      freePlay: { ...base.freePlay, ...parsed.freePlay },
    }
  } catch {
    return base
  }
}

export function saveState(state: AppState, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Storage full or blocked (private mode): the app keeps working in memory.
  }
}
