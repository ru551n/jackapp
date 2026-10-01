import { capitalize, numberWord } from '../../core/swedish'
import type { Level, SceneItem, SpriteId, Theme } from '../../core/types'

/** A countable transport thing with its Swedish forms. */
export interface Thing {
  sprite: SpriteId
  theme: Theme
  one: string
  many: string
  gender: 'en' | 'ett'
}

export const CARRIAGES: Thing = { sprite: 'carriage', theme: 'train', one: 'vagn', many: 'vagnar', gender: 'en' }
export const METRO_CARS: Thing = { sprite: 'metroCar', theme: 'metro', one: 'vagn', many: 'vagnar', gender: 'en' }
export const PASSENGERS: Thing = {
  sprite: 'passenger',
  theme: 'metro',
  one: 'resenär',
  many: 'resenärer',
  gender: 'en',
}
export const SUITCASES: Thing = { sprite: 'suitcase', theme: 'train', one: 'väska', many: 'väskor', gender: 'en' }
export const PLANES: Thing = { sprite: 'airliner', theme: 'airport', one: 'flygplan', many: 'flygplan', gender: 'ett' }

/** "tre vagnar" / "en vagn" / "ett flygplan". */
export const qty = (t: Thing, n: number) => `${numberWord(n, t.gender)} ${n === 1 ? t.one : t.many}`
export const Qty = (t: Thing, n: number) => capitalize(qty(t, n))

export const items = (t: Thing, n: number, state?: SceneItem['state'], group?: number): SceneItem[] =>
  Array.from({ length: n }, () => ({
    sprite: t.sprite,
    ...(state && { state }),
    ...(group !== undefined && { group }),
  }))

/** Items split into groups of `size` so they are easy to count. */
export const grouped = (t: Thing, n: number, size: number): SceneItem[] =>
  items(t, n).map((it, i) => ({ ...it, group: Math.floor(i / size) }))

/** Shared numeric range per level for count/compare/oneMoreLess/sequence/arith (docs/content-guide.md). */
export const MAX_BY_LEVEL: Record<Level, number> = { 1: 5, 2: 6, 3: 8, 4: 10, 5: 12 }
/** Smallest starting quantity per level, so higher levels never open on a trivial 1-2 items. */
export const MIN_BY_LEVEL: Record<Level, number> = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 6 }
/** Max quantity when extra support also shows fewer items. */
export const EXTRA_MAX = 8

/** Item row grouped in pairs for extra support, otherwise plain. */
export const supportRow = (t: Thing, n: number, support: 'normal' | 'extra') =>
  support === 'extra' ? grouped(t, n, 2) : items(t, n)
