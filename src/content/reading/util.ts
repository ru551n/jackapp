import type { Level, SpriteId, Support } from '../../core/types'

/** Signs use capitals at levels 1–2; mixed case from level 3. Names are stored in mixed case. */
export const cased = (level: Level, w: string) => (level <= 2 ? w.toUpperCase() : w)

/** Number of choices: 2 at level 1 or with extra support, then 3, then 4. */
export const choiceCount = (level: Level, support: Support) =>
  support === 'extra' || level === 1 ? 2 : level === 2 ? 3 : 4

export const ALPHABET = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZÅÄÖ']

export interface Word {
  /** Lowercase form, e.g. "tåg". */
  w: string
  sprite?: SpriteId
}

export const WORDS: Word[] = [
  { w: 'tåg', sprite: 'locomotive' },
  { w: 'spårvagn', sprite: 'tram' },
  { w: 'tunnelbana', sprite: 'metroCar' },
  { w: 'flygplan', sprite: 'airliner' },
  { w: 'resenär', sprite: 'passenger' },
  { w: 'väska', sprite: 'suitcase' },
  { w: 'station', sprite: 'station' },
  { w: 'signal', sprite: 'signal' },
  { w: 'vagn', sprite: 'carriage' },
  { w: 'spår' },
  { w: 'buss' },
  { w: 'perrong' },
  { w: 'biljett' },
  { w: 'åka' },
  { w: 'örn' },
]

/** Names (mixed case) usable as signs. All are real Stockholm metro stations. */
export const METRO_STATIONS = [
  'T-Centralen',
  'Slussen',
  'Odenplan',
  'Gamla stan',
  'Hötorget',
  'Kista',
  'Skanstull',
  'Gullmarsplan',
  'Fridhemsplan',
  'Mariatorget',
]

/** Real Swedish cities with train service. */
export const CITIES = ['Stockholm', 'Göteborg', 'Malmö', 'Uppsala', 'Umeå', 'Luleå', 'Kiruna', 'Sundsvall', 'Örebro']

/** Short picture names for aria labels. */
export const SPRITE_NAMES: Record<SpriteId, string> = {
  locomotive: 'tåg',
  carriage: 'vagn',
  metroCar: 'tunnelbana',
  tram: 'spårvagn',
  passenger: 'resenär',
  suitcase: 'väska',
  airliner: 'flygplan',
  jet: 'jaktflygplan',
  signal: 'signal',
  station: 'station',
}
