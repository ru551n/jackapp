import type { ComponentType } from 'react'
import type { VehicleArtProps } from './types'

/** Original aircraft illustrations keyed by vehicle id (owned by the aviation track). */
export const AIRCRAFT_ART: Record<string, ComponentType<VehicleArtProps>> = {}
