import type { Choice, Hint, Level, SpriteId } from '../../core/types'
import { wrongIds } from '../helpers'

/** Signs use capitals at levels 1–2; mixed case from level 3. Names are stored in mixed case. */
export const cased = (level: Level, w: string) => (level <= 2 ? w.toUpperCase() : w)

/** `first` is real support; the eliminate hint is only added when it can actually remove something (3+ choices). */
export const withElim = (first: Hint, choices: Choice[], answer: string, text: string): Hint[] =>
  choices.length > 2 ? [first, { text, eliminate: wrongIds(choices, answer) }] : [first]

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
  { w: 'buss', sprite: 'bus' },
  { w: 'bil', sprite: 'car' },
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
/** Look-alike distractors for destination signs (same first letter as many cities). */
export const CITIES_EXTRA = [
  'Strömstad',
  'Skövde',
  'Sala',
  'Södertälje',
  'Gävle',
  'Gnesta',
  'Gällivare',
  'Mora',
  'Märsta',
  'Mjölby',
  'Motala',
  'Uddevalla',
  'Ulricehamn',
  'Karlstad',
  'Kalmar',
  'Katrineholm',
  'Lund',
  'Ludvika',
  'Laxå',
  'Östersund',
  'Örnsköldsvik',
  'Öxnered',
]

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
  jet: 'stridsflygplan',
  signal: 'signal',
  station: 'station',
  bus: 'buss',
  car: 'bil',
}
