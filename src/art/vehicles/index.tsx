import type { ComponentType } from 'react'
import type { Vehicle, VehicleCategory, SpriteId } from '../../core/types'
import { Sprite } from '../sprites'
import { AIRCRAFT_ART } from './aircraft'
import { RAIL_ART } from './rail'
import type { VehicleArtProps } from './types'

/**
 * Per-vehicle original illustrations, keyed by vehicle id. Domain owners register their art in
 * their own module (aircraft.tsx, rail.tsx) and it is merged here.
 */
const ART: Record<string, ComponentType<VehicleArtProps>> = { ...RAIL_ART, ...AIRCRAFT_ART }

const FALLBACK: Record<VehicleCategory, SpriteId> = {
  train: 'locomotive',
  metro: 'metroCar',
  tram: 'tram',
  airliner: 'airliner',
  fighter: 'jet',
}

export function VehicleArt({ vehicle, mode = 'color', className }: { vehicle: Vehicle } & VehicleArtProps) {
  const Art = ART[vehicle.id]
  if (Art) return <Art mode={mode} className={className} />
  return (
    <Sprite id={FALLBACK[vehicle.category]} tint={mode === 'silhouette' ? 'grey' : undefined} className={className} />
  )
}
