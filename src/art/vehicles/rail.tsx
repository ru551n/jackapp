import type { ComponentType } from 'react'
import type { VehicleArtProps } from './types'

/** Original train, metro and tram illustrations keyed by vehicle id (owned by the collection track). */
export const RAIL_ART: Record<string, ComponentType<VehicleArtProps>> = {}
