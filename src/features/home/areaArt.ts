import type { AreaId, SpriteId } from '../../core/types'

export const AREA_SPRITE: Record<AreaId, SpriteId> = {
  stationen: 'station',
  tunnelbanan: 'metroCar',
  sparvagnen: 'tram',
  flygplatsen: 'airliner',
}
