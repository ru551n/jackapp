import { areaById } from '../../core/catalog'
import type { Vehicle, VehicleCategory } from '../../core/types'
import { missionsLeft } from '../../content/vehicles'
import type { AppState } from '../../core/types'

export const SECTIONS: { category: VehicleCategory; title: string }[] = [
  { category: 'train', title: 'Tåg' },
  { category: 'metro', title: 'Tunnelbana' },
  { category: 'tram', title: 'Spårvagnar' },
  { category: 'airliner', title: 'Passagerarflygplan' },
  { category: 'fighter', title: 'Stridsflygplan' },
]

/** Ids of the single closest locked vehicle per unlock area (the only ones that show a count). */
export function nextIds(vehicles: Vehicle[], missions: AppState['missions']): Set<string> {
  const best = new Map<string, Vehicle>()
  for (const v of vehicles) {
    const left = missionsLeft(v, missions)
    const cur = best.get(v.unlock.area)
    if (left > 0 && (!cur || left < missionsLeft(cur, missions))) best.set(v.unlock.area, v)
  }
  return new Set([...best.values()].map((v) => v.id))
}

/** Locked-card hint: a count for the next unlock ("2 uppdrag kvar i Flygplatsen"), otherwise just "Låst". */
export function lockedHint(v: Vehicle, missions: AppState['missions'], isNext: boolean): string {
  const area = v.unlock.area === 'any' ? '' : (areaById(v.unlock.area)?.name ?? '')
  if (!isNext) return area ? `Låst · ${area}` : 'Låst'
  const n = missionsLeft(v, missions)
  return `${n} uppdrag kvar${area ? ` i ${area}` : ''}`
}
