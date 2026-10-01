import { numberWord } from '../../core/swedish'
import type {
  VehicleCategory,
  Hint,
  Choice,
  Question,
  Rng,
  SceneItem,
  SpriteId,
  Support,
  Theme,
  Tint,
} from '../../core/types'

/** The single English vocabulary used by every generator in this area. */
export interface Noun {
  en: string
  plural: string
  sv: string
  /** Definite Swedish form and whether it is neuter (colour adjectives: röd / rött). */
  svDef: string
  /** Swedish indefinite plural: tåg, bussar, tunnelbanor. */
  svPl: string
  neuter: boolean
  sprite: SpriteId
  theme: Theme
}

export const NOUNS: Noun[] = [
  {
    en: 'train',
    plural: 'trains',
    sv: 'tåg',
    svDef: 'tåget',
    svPl: 'tåg',
    neuter: true,
    sprite: 'locomotive',
    theme: 'train',
  },
  {
    en: 'tram',
    plural: 'trams',
    sv: 'spårvagn',
    svDef: 'spårvagnen',
    svPl: 'spårvagnar',
    neuter: false,
    sprite: 'tram',
    theme: 'tram',
  },
  {
    en: 'metro',
    plural: 'metros',
    sv: 'tunnelbana',
    svDef: 'tunnelbanan',
    svPl: 'tunnelbanor',
    neuter: false,
    sprite: 'metroCar',
    theme: 'metro',
  },
  {
    en: 'plane',
    plural: 'planes',
    sv: 'flygplan',
    svDef: 'flygplanet',
    svPl: 'flygplan',
    neuter: true,
    sprite: 'airliner',
    theme: 'airport',
  },
  {
    en: 'jet',
    plural: 'jets',
    sv: 'jetplan',
    svDef: 'jetplanet',
    svPl: 'jetplan',
    neuter: true,
    sprite: 'jet',
    theme: 'airport',
  },
  {
    en: 'bus',
    plural: 'buses',
    sv: 'buss',
    svDef: 'bussen',
    svPl: 'bussar',
    neuter: false,
    sprite: 'bus',
    theme: 'train',
  },
  { en: 'car', plural: 'cars', sv: 'bil', svDef: 'bilen', svPl: 'bilar', neuter: false, sprite: 'car', theme: 'train' },
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
    svPl: 'stationer',
    neuter: false,
    sprite: 'station',
    theme: 'train',
  },
  {
    en: 'passenger',
    plural: 'passengers',
    sv: 'passagerare',
    svDef: 'passageraren',
    svPl: 'passagerare',
    neuter: false,
    sprite: 'passenger',
    theme: 'airport',
  },
  {
    en: 'suitcase',
    plural: 'suitcases',
    sv: 'resväska',
    svDef: 'resväskan',
    svPl: 'resväskor',
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

/** Swedish prompt at L1–2 (and with extra support); `until` raises the cut-off level. */
export const swedishLevel = (level: number, support: Support, until = 2) => level <= until || support === 'extra'
/** The word sign stays visible one level longer than the Swedish prompt (L1–3). */
export const showSign = (level: number, support: Support) => level <= 3 || support === 'extra'

/** Prompt fields. Swedish prompt: English word on the listen button. English prompt: "På svenska" via speech. */
export function ask(
  level: number,
  support: Support,
  p: { sv: string; en: string; say?: string; speech?: string },
  until = 2,
): Pick<Question, 'prompt' | 'promptLang' | 'speech' | 'listen'> {
  const speech = p.speech ?? 'Tryck på rätt bild.'
  if (!swedishLevel(level, support, until)) return { prompt: p.en, promptLang: 'en', speech }
  return { prompt: p.sv, speech, listen: p.say ? { text: p.say, lang: 'en' } : undefined }
}

export const row = (...items: SceneItem[]) => ({ kind: 'row' as const, items })
export const wordSign = (text: string) => ({ kind: 'sign' as const, text, style: 'word' as const, lang: 'en' as const })
export const picChoice = (id: string, aria: string, ...items: SceneItem[]): Choice => ({
  id,
  visual: row(...items),
  ariaLabel: aria,
})
/** Size choice: an airliner at `scale`, with a passenger beside it as a size reference. */
export const sizeChoice = (scale: number, aria: string): Choice => ({
  id: String(scale),
  ariaLabel: aria,
  visual: {
    kind: 'group',
    direction: 'row',
    scenes: [{ kind: 'vehicle', vehicle: 'a320', scale }, row({ sprite: 'passenger' })],
  },
})

/** Swedish noun phrases with correct gender and number. */
export const svOne = (n: Noun) => `${n.neuter ? 'ett' : 'en'} ${n.sv}`
export const svCol = (c: Color, n: Noun) => `${n.neuter ? c.svT : c.sv} ${n.sv}`
export const svColA = (c: Color, n: Noun) => `${n.neuter ? 'ett' : 'en'} ${svCol(c, n)}`
export const svCount = (k: number, n: Noun) => (k === 1 ? svOne(n) : `${numberWord(k)} ${n.svPl}`)
export const enCount = (k: number, n: Noun) => `${NUMBER_WORDS[k]} ${k === 1 ? n.en : n.plural}`

/** Translation hint: the English text is shown, the Swedish voice says only Swedish, English has its own button. */
export function gloss(en: string, sv: string, scene?: Hint['scene']): Hint {
  const same = en.toLowerCase() === sv.toLowerCase()
  return {
    text: same ? `${en}: samma ord på svenska.` : `${en} = ${sv}.`,
    speech: same ? 'Samma ord på svenska.' : `Det betyder ${sv}.`,
    listen: { text: en, lang: 'en' },
    scene,
  }
}

type Look = (t: { en: string }) => boolean
const AIR: Look = (t) => t.en === 'plane' || t.en === 'jet'
const RAIL: Look = (t) => ['train', 'tram', 'metro'].includes(t.en)

/** `n` items without look-alikes: plane+jet never together; train/tram/metro not together at L1–3. */
export function distinct<T extends { en: string }>(rng: Rng, pool: readonly T[], n: number, first?: T, level = 1): T[] {
  const guards = level <= 3 ? [AIR, RAIL] : [AIR]
  const out: T[] = first ? [first] : []
  for (const t of rng.shuffle(pool)) {
    if (out.length >= n) break
    if (out.includes(t) || guards.some((g) => g(t) && out.some(g))) continue
    out.push(t)
  }
  return out
}

/** 2 choices at L1, then 3, then 4 (one fewer with extra support, never below 2). */
export const choiceCount = (level: number, support: Support) =>
  Math.max(2, (level <= 1 ? 2 : level <= 3 ? 3 : 4) - (support === 'extra' ? 1 : 0))

export type Color = (typeof COLORS)[number]
export const colourPic = (c: Color, n: Noun): Choice =>
  picChoice(`${c.tint}:${n.en}`, svCol(c, n), { sprite: n.sprite, tint: c.tint })

/** One English word per vehicle category, shown lightly on collection cards ("Tåg — train"). */
export const CATEGORY_WORD: Record<VehicleCategory, string> = {
  train: 'train',
  metro: 'metro',
  tram: 'tram',
  airliner: 'plane',
  fighter: 'jet',
}
