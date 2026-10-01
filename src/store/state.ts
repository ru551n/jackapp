import type { AppState } from '../core/types'

/** The original single-child key. Read for migration only; never written or deleted by the learner area. */
export const LEGACY_KEY = 'jackapp:v1'
/** Per-learner progress on this device. */
export const learnerKey = (learnerId: string) => `${LEGACY_KEY}:${learnerId}`

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

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0)

/**
 * Load from localStorage. Every field is shape-checked and falls back to its default, so damaged
 * data can never lock the child out of the app.
 */
export function loadState(
  storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage,
  key = LEGACY_KEY,
): AppState {
  const base = defaultState()
  try {
    const raw = storage?.getItem(key)
    if (!raw) return base
    const p: unknown = JSON.parse(raw)
    if (!isObj(p) || p.version !== 1) return base
    const progress = isObj(p.progress) ? p.progress : {}
    const missions = isObj(p.missions) ? p.missions : {}
    return {
      ...base,
      progress: Object.fromEntries(
        Object.entries(progress).filter(([, v]) => isObj(v) && Array.isArray(v.recent) && typeof v.level === 'number'),
      ) as AppState['progress'],
      missions: Object.fromEntries(
        Object.keys(base.missions).map((k) => [k, count(missions[k])]),
      ) as AppState['missions'],
      sessionCounter: count(p.sessionCounter),
      recentQuestionIds: Array.isArray(p.recentQuestionIds)
        ? p.recentQuestionIds.filter((x) => typeof x === 'string')
        : [],
      sessions: Array.isArray(p.sessions) ? (p.sessions.filter(isObj) as unknown as AppState['sessions']) : [],
      settings: { ...base.settings, ...(isObj(p.settings) ? (p.settings as Partial<AppState['settings']>) : {}) },
      parentPin: typeof p.parentPin === 'string' && /^\d{4}$/.test(p.parentPin) ? p.parentPin : undefined,
      freePlay: {
        line:
          isObj(p.freePlay) && isObj(p.freePlay.line) && Array.isArray(p.freePlay.line.stations)
            ? (p.freePlay.line as unknown as AppState['freePlay']['line'])
            : null,
      },
    }
  } catch {
    return base
  }
}

export function saveState(
  state: AppState,
  key: string,
  storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage,
) {
  try {
    storage?.setItem(key, JSON.stringify(state))
  } catch {
    // Storage full or blocked (private mode): the app keeps working in memory.
  }
}
