import { areaById } from '../../core/catalog'
import type { AppState, Vehicle, VehicleCategory } from '../../core/types'

export const SECTIONS: { category: VehicleCategory; title: string }[] = [
  { category: 'train', title: 'Tåg' },
  { category: 'metro', title: 'Tunnelbana' },
  { category: 'tram', title: 'Spårvagnar' },
  { category: 'airliner', title: 'Passagerarflygplan' },
  { category: 'fighter', title: 'Stridsflygplan' },
]

/** Missions still needed to unlock `v` (0 when unlocked). Mirrors isUnlocked in content/vehicles. */
export function missionsLeft(v: Vehicle, missions: AppState['missions']): number {
  const { area, missions: need } = v.unlock
  const have = area === 'any' ? Object.values(missions).reduce((a, b) => a + b, 0) : missions[area]
  return Math.max(0, need - have)
}

/** Calm hint for a locked card, e.g. "2 uppdrag till i Flygplatsen". */
export function remainingText(v: Vehicle, missions: AppState['missions']): string {
  const n = missionsLeft(v, missions)
  const where = v.unlock.area === 'any' ? '' : ` i ${areaById(v.unlock.area)?.name ?? 'appen'}`
  return `${n} uppdrag till${where}`
}
