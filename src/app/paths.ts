import { useParams } from 'react-router'
import type { AreaId } from '../core/types'

/** Paths inside a learner's area (`/l/:learnerId/...`); without a learner id they are unscoped (tests, legacy). */
export function learnerPaths(learnerId?: string) {
  const b = learnerId ? `/l/${learnerId}` : ''
  return {
    home: b || '/',
    area: (area: AreaId) => `${b}/omrade/${area}`,
    session: (area: AreaId) => `${b}/omrade/${area}/uppdrag`,
    collection: `${b}/samling`,
    vehicle: (id: string) => `${b}/samling/${id}`,
    freePlay: `${b}/bygg`,
    materials: `${b}/material`,
    material: (artifactId: string) => `${b}/material/${artifactId}`,
    request: `${b}/onska`,
    /** The learner picker ("Byt elev"). */
    picker: '/',
  }
}

export type LearnerPaths = ReturnType<typeof learnerPaths>

/** Paths for the learner in the current route. */
export const usePaths = () => learnerPaths(useParams().learnerId)

/** Unscoped paths, for code outside a learner area. */
export const paths = learnerPaths()
