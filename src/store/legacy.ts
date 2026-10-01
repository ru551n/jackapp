import type { AppState } from '../core/types'
import { LEGACY_KEY, loadState } from './state'

// One-time offer of the old single-child progress (`jackapp:v1`) to an early-band learner.
// The legacy key is never deleted here: it stays until an adult has imported it to the server.

const OFFER_KEY = 'jackapp:legacy-offer'

interface Offer {
  /** The learner who took over the legacy progress on this device. */
  claimedBy?: string
  /** Learners for whom an adult said no (they are not asked again). */
  declined: string[]
}

type Store = Pick<Storage, 'getItem' | 'setItem'>

function readOffer(storage: Store): Offer {
  try {
    const o = JSON.parse(storage.getItem(OFFER_KEY) ?? '{}') as Partial<Offer>
    return {
      claimedBy: typeof o.claimedBy === 'string' ? o.claimedBy : undefined,
      declined: Array.isArray(o.declined) ? o.declined.filter((x) => typeof x === 'string') : [],
    }
  } catch {
    return { declined: [] }
  }
}

function writeOffer(o: Offer, storage: Store) {
  try {
    storage.setItem(OFFER_KEY, JSON.stringify(o))
  } catch {
    // Blocked storage: the question may come back next time, nothing is lost.
  }
}

const hasContent = (s: AppState) =>
  Object.values(s.missions).some((n) => n > 0) || Object.keys(s.progress).length > 0 || s.freePlay.line !== null

/** Legacy progress to offer this learner, or null (none, empty/corrupt, already claimed, or declined). */
export function legacyOffer(learnerId: string, storage: Store = globalThis.localStorage): AppState | null {
  try {
    if (!storage.getItem(LEGACY_KEY)) return null
  } catch {
    return null
  }
  const o = readOffer(storage)
  if (o.claimedBy || o.declined.includes(learnerId)) return null
  const s = loadState(storage, LEGACY_KEY)
  return hasContent(s) ? s : null
}

export function claimLegacy(learnerId: string, storage: Store = globalThis.localStorage) {
  writeOffer({ ...readOffer(storage), claimedBy: learnerId }, storage)
}

export function declineLegacy(learnerId: string, storage: Store = globalThis.localStorage) {
  const o = readOffer(storage)
  writeOffer({ ...o, declined: [...new Set([...o.declined, learnerId])] }, storage)
}

/** For the adult import: which learner (if any) took over the legacy progress on this device. */
export const legacyClaimedBy = (storage: Store = globalThis.localStorage) => readOffer(storage).claimedBy
