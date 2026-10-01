import type { AreaId, SpriteId } from '../../../core/types'
import { AREA_SPRITE } from '../../home/areaArt'
import type { Option } from '../requests'

// Early-years subjects as pictures, and where finished AI material counts in the collection.

export const EARLY_SUBJECTS: (Option & { area: AreaId })[] = [
  { id: 'GRGRSVE01', label: 'Läsa', sprite: AREA_SPRITE.stationen, area: 'stationen' },
  { id: 'GRGRMAT01', label: 'Räkna', sprite: AREA_SPRITE.tunnelbanan, area: 'tunnelbanan' },
  { id: 'GRGRENG01', label: 'Engelska', sprite: AREA_SPRITE.engelska, area: 'engelska' },
  { id: 'GRGRTEK01', label: 'Teknik', sprite: AREA_SPRITE.sparvagnen, area: 'sparvagnen' },
]

/** Finished AI material counts as one mission in the matching area; other subjects count at Flygplatsen. */
export const areaForSubject = (code?: string | null): AreaId =>
  EARLY_SUBJECTS.find((s) => s.id === code)?.area ?? 'flygplatsen'

const THEME_SPRITE: [RegExp, SpriteId][] = [
  [/tunnelbana|metro/i, 'metroCar'],
  [/spårvagn|tram/i, 'tram'],
  [/flyg|plan/i, 'airliner'],
  [/tåg|järnväg|lok/i, 'locomotive'],
  [/buss/i, 'bus'],
  [/bil/i, 'car'],
]

/** The learner's interests as picture choices; transport themes when the profile has none. */
export function themeOptions(interests: string[] | undefined): Option[] {
  const list = interests?.length ? interests : ['Tåg', 'Tunnelbana', 'Spårvagn', 'Flygplan']
  return list.map((t) => ({ id: t, label: t, sprite: THEME_SPRITE.find(([re]) => re.test(t))?.[1] ?? 'station' }))
}
