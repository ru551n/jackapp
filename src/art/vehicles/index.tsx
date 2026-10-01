import type { ComponentType } from 'react'
import type { Vehicle, VehicleCategory, SpriteId } from '../../core/types'
import { Sprite } from '../sprites'

export interface VehicleArtProps {
  /** 'silhouette' renders a single dark shape (for recognition tasks). */
  mode?: 'color' | 'silhouette'
  className?: string
}

/**
 * Per-vehicle original illustrations, keyed by vehicle id. Domain owners register their art in
 * their own module (aircraft.tsx, rail.tsx) and it is merged here.
 */
const ART: Record<string, ComponentType<VehicleArtProps>> = {}

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
