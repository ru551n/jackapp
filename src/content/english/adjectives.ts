import type { Generator } from '../../core/types'
import { wrongIds } from '../helpers'
import { ask, picChoice, wordSign } from './vocab'

/** Gripen drawn at different scales: big = largest, small = smallest. */
export const bigSmall: Generator = {
  id: 'en.adjectives.bigSmall',
  skill: 'en.adjectives',
  levels: [1, 5],
  generate({ rng, level, support }) {
    const big = rng.next() < 0.5
    const scales = level <= 1 || support === 'extra' ? [1, 0.4] : [1, 0.7, 0.4]
    const choices = rng.shuffle(scales).map((s) => ({
      id: String(s),
      visual: { kind: 'vehicle' as const, vehicle: 'gripen', scale: s },
      ariaLabel: s === 1 ? 'stort' : s === 0.4 ? 'litet' : 'mellan',
    }))
    const adj = big ? 'big' : 'small'
    const sv = big ? 'stor' : 'liten'
    const answer = String(big ? 1 : 0.4)
    const q4 = level >= 4
    return {
      id: `en.adjectives.bigSmall:${adj}:${scales.length}:${q4 ? 'q' : 't'}`,
      skill: 'en.adjectives',
      level,
      theme: 'fighter',
      ...ask(level, support, {
        sv: `Tryck på ${adj}.`,
        en: q4 ? `Which plane is ${adj}?` : `Tap the ${adj} plane.`,
        say: adj,
      }),
      scene: level <= 2 || support === 'extra' ? wordSign(adj) : undefined,
      task: { kind: 'choice', choices, answer },
      hints: [
        { text: `${adj} betyder ${sv}.`, scene: wordSign(adj) },
        { text: `Hitta det ${big ? 'största' : 'minsta'} planet.`, eliminate: wrongIds(choices, answer) },
      ],
      success: `Ja! ${adj} = ${sv}.`,
    }
  },
}

const FAST = [
  { en: 'plane', sprite: 'airliner', sv: 'flygplan' },
  { en: 'jet', sprite: 'jet', sv: 'jetplan' },
] as const
const SLOW = [
  { en: 'bus', sprite: 'bus', sv: 'buss' },
  { en: 'car', sprite: 'car', sv: 'bil' },
] as const

/** fast = a plane, slow = a bus or car (compared with each other). */
export const fastSlow: Generator = {
  id: 'en.adjectives.fastSlow',
  skill: 'en.adjectives',
  levels: [2, 5],
  generate({ rng, level, support }) {
    const fast = rng.next() < 0.5
    const f = rng.pick(FAST)
    const s = rng.pick(SLOW)
    const adj = fast ? 'fast' : 'slow'
    const sv = fast ? 'snabb' : 'långsam'
    const t = fast ? f : s
    const choices = rng.shuffle([f, s]).map((x) => picChoice(x.en, x.sv, { sprite: x.sprite }))
    return {
      id: `en.adjectives.fastSlow:${adj}:${f.en}-${s.en}:${level >= 4 ? 'q' : 't'}`,
      skill: 'en.adjectives',
      level,
      theme: 'airport',
      ...ask(level, support, {
        sv: `Tryck på ${adj}.`,
        en: level >= 4 ? `Which is ${adj}?` : `Tap the ${adj} one.`,
        say: adj,
      }),
      scene: level <= 2 || support === 'extra' ? wordSign(adj) : undefined,
      task: { kind: 'choice', choices, answer: t.en },
      hints: [
        { text: `${adj} betyder ${sv}.`, scene: wordSign(adj) },
        { text: `Vilket går ${fast ? 'snabbast' : 'långsammast'}?`, eliminate: [] },
      ],
      success: `Ja! ${adj} = ${sv}.`,
    }
  },
}
