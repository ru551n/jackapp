import type { AppState, AreaId, Vehicle } from '../../core/types'
import { AIRCRAFT } from './aircraft'
import { RAIL_VEHICLES } from './rail'

export const VEHICLES: Vehicle[] = [...RAIL_VEHICLES, ...AIRCRAFT]

export const vehicleById = (id: string): Vehicle | undefined => VEHICLES.find((v) => v.id === id)

/** Completed missions that count toward an unlock rule ('any' = all areas). */
export const missionsFor = (area: AreaId | 'any', missions: AppState['missions']) =>
  area === 'any' ? Object.values(missions).reduce((a, b) => a + b, 0) : missions[area]

export const isUnlocked = (v: Vehicle, missions: AppState['missions']) =>
  missionsFor(v.unlock.area, missions) >= v.unlock.missions

/** The next locked vehicle reachable by playing `area` (area-specific first, then 'any'), with missions remaining. */
export function nextUnlock(
  area: AreaId,
  missions: AppState['missions'],
): { vehicle: Vehicle; remaining: number } | null {
  const candidates = VEHICLES.filter(
    (v) => !isUnlocked(v, missions) && (v.unlock.area === area || v.unlock.area === 'any'),
  )
    .map((vehicle) => ({ vehicle, remaining: vehicle.unlock.missions - missionsFor(vehicle.unlock.area, missions) }))
    .sort((a, b) => a.remaining - b.remaining)
  return candidates[0] ?? null
}

/** Vehicles that became unlocked between two mission snapshots. */
export const newlyUnlocked = (before: AppState['missions'], after: AppState['missions']) =>
  VEHICLES.filter((v) => !isUnlocked(v, before) && isUnlocked(v, after))

/** Missions still needed to unlock `v` (0 when unlocked). */
export const missionsLeft = (v: Vehicle, missions: AppState['missions']) =>
  Math.max(0, v.unlock.missions - missionsFor(v.unlock.area, missions))
