import { createContext } from 'react'
import { useOutletContext } from 'react-router'
import type { LearnerProfile, Resource } from './api'

/** Locks the adult area (provided by AdultArea, used by the "Lås" button). */
export const LockContext = createContext<(() => void) | null>(null)

export interface LearnerContext {
  learner: LearnerProfile
  resource: Resource<LearnerProfile>
}

/** The learner loaded by LearnerLayout for all `/vuxen/elev/:id/*` pages. */
export const useLearner = () => useOutletContext<LearnerContext>()
