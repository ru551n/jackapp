import type { Choice, Question, Rng, SceneItem, SpriteId, Support, Theme, Tint } from '../../core/types'

/** The single English vocabulary used by every generator in this area. */
export interface Noun {
  en: string
  plural: string
  sv: string
  /** Definite Swedish form and whether it is neuter (colour adjectives: röd / rött). */
  svDef: string
  neuter: boolean
  sprite: SpriteId
  theme: Theme
}

export const NOUNS: Noun[] = [
  { en: 'train', plural: 'trains', sv: 'tåg', svDef: 'tåget', neuter: true, sprite: 'locomotive', theme: 'train' },
  { en: 'tram', plural: 'trams', sv: 'spårvagn', svDef: 'spårvagnen', neuter: false, sprite: 'tram', theme: 'tram' },
  {
    en: 'metro',
    plural: 'metros',
    sv: 'tunnelbana',
    svDef: 'tunnelbanan',
    neuter: false,
    sprite: 'metroCar',
    theme: 'metro',
  },
  {
    en: 'plane',
    plural: 'planes',
    sv: 'flygplan',
    svDef: 'flygplanet',
    neuter: true,
    sprite: 'airliner',
    theme: 'airport',
  },
  { en: 'jet', plural: 'jets', sv: 'jetplan', svDef: 'jetplanet', neuter: true, sprite: 'jet', theme: 'airport' },
  { en: 'bus', plural: 'buses', sv: 'buss', svDef: 'bussen', neuter: false, sprite: 'bus', theme: 'train' },
  { en: 'car', plural: 'cars', sv: 'bil', svDef: 'bilen', neuter: false, sprite: 'car', theme: 'train' },
]
/** Nouns that are vehicles (colour, counting, sentences). */
export const VEHICLES = NOUNS
/** Other nouns with a picture (words only). */
export const PICTURE_NOUNS = [
  ...NOUNS,
  {
    en: 'station',
    plural: 'stations',
    sv: 'station',
    svDef: 'stationen',
    neuter: false,
    sprite: 'station',
    theme: 'train',
  },
  {
    en: 'passenger',
    plural: 'passengers',
    sv: 'passagerare',
    svDef: 'passageraren',
    neuter: false,
    sprite: 'passenger',
    theme: 'airport',
  },
  {
    en: 'suitcase',
    plural: 'suitcases',
    sv: 'resväska',
    svDef: 'resväskan',
    neuter: false,
    sprite: 'suitcase',
    theme: 'airport',
  },
] as Noun[]

/** Words without a clean sprite; `clue` is a Swedish hint that does not give the word away. */
export interface ExtraWord {
  en: string
  sv: string
  clue: string
  scene?: Question['scene']
}
export const EXTRA_WORDS: ExtraWord[] = [
  {
    en: 'airport',
    sv: 'flygplats',
    clue: 'Dit kommer flygplan och passagerare.',
    scene: { kind: 'row', items: [{ sprite: 'airliner' }, { sprite: 'suitcase' }] },
  },
  {
    en: 'gate',
    sv: 'utgång',
    clue: 'Där går man ombord på flygplanet.',
    scene: { kind: 'sign', text: 'B4', style: 'gate' },
  },
  { en: 'pilot', sv: 'pilot', clue: 'Hen flyger flygplanet.' },
  {
    en: 'wing',
    sv: 'vinge',
    clue: 'Den sitter på sidan av flygplanet.',
    scene: { kind: 'vehicle', vehicle: 'gripen' },
  },
  { en: 'hello', sv: 'hej', clue: 'Man säger det när man möts.' },
  { en: 'goodbye', sv: 'hej då', clue: 'Man säger det när man går.' },
  {
    en: 'stop',
    sv: 'stanna',
    clue: 'Signalen är röd.',
    scene: { kind: 'row', items: [{ sprite: 'signal', tint: 'red' }] },
  },
  {
    en: 'go',
    sv: 'kör',
    clue: 'Signalen är grön.',
    scene: { kind: 'row', items: [{ sprite: 'signal', tint: 'green' }] },
  },
]

export const COLORS: { tint: Tint; en: string; sv: string; svT: string }[] = [
  { tint: 'red', en: 'red', sv: 'röd', svT: 'rött' },
  { tint: 'blue', en: 'blue', sv: 'blå', svT: 'blått' },
  { tint: 'green', en: 'green', sv: 'grön', svT: 'grönt' },
  { tint: 'yellow', en: 'yellow', sv: 'gul', svT: 'gult' },
]

export const NUMBER_WORDS = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

/** Swedish instruction prompt at L1–2 (and with extra support), English afterwards. */
export const swedishLevel = (level: number, support: Support) => level <= 2 || support === 'extra'

/** Prompt fields: Swedish speech only; the English text goes on the "Hör på engelska" button. */
export function ask(
  level: number,
  support: Support,
  p: { sv: string; en: string; say?: string; speech?: string },
): Pick<Question, 'prompt' | 'speech' | 'listen'> {
  const sw = swedishLevel(level, support)
  return {
    prompt: sw ? p.sv : p.en,
    speech: p.speech ?? 'Tryck på rätt bild.',
    listen: sw && !p.say ? undefined : { text: sw ? p.say! : p.en, lang: 'en' },
  }
}

export const row = (...items: SceneItem[]) => ({ kind: 'row' as const, items })
export const wordSign = (text: string) => ({ kind: 'sign' as const, text, style: 'word' as const })
export const picChoice = (id: string, aria: string, ...items: SceneItem[]): Choice => ({
  id,
  visual: row(...items),
  ariaLabel: aria,
})

/** `n` items with different look-alike groups avoided: plane and jet never share a choice set. */
export function distinct<T extends { en: string }>(rng: Rng, pool: readonly T[], n: number, first?: T): T[] {
  const air = (t: T) => t.en === 'plane' || t.en === 'jet'
  const out: T[] = first ? [first] : []
  for (const t of rng.shuffle(pool)) {
    if (out.length >= n) break
    if (out.includes(t) || (air(t) && out.some(air))) continue
    out.push(t)
  }
  return out
}

/** 2 choices at L1, then 3, then 4 (one fewer with extra support, never below 2). */
export const choiceCount = (level: number, support: Support) =>
  Math.max(2, (level <= 1 ? 2 : level <= 3 ? 3 : 4) - (support === 'extra' ? 1 : 0))

export type Color = (typeof COLORS)[number]
export const colourPic = (c: Color, n: Noun): Choice =>
  picChoice(`${c.tint}:${n.en}`, `${c.sv} ${n.sv}`, { sprite: n.sprite, tint: c.tint })
