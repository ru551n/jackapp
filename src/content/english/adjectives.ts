import type { Generator } from '../../core/types'
import { capitalize } from '../../core/swedish'
import { wrongIds } from '../helpers'
import { NOUNS, ask, gloss, picChoice, showSign, sizeChoice, wordSign } from './vocab'

/** An airliner at different scales, each with a passenger as a size reference. */
export const bigSmall: Generator = {
  id: 'en.adjectives.bigSmall',
  skill: 'en.adjectives',
  levels: [1, 5],
  generate({ rng, level, support }) {
    const big = rng.next() < 0.5
    const scales = level <= 1 || support === 'extra' ? [1, 0.4] : [1, 0.7, 0.4]
    const choices = rng
      .shuffle(scales)
      .map((s) => sizeChoice(s, s === 1 ? 'stort flygplan' : s === 0.4 ? 'litet flygplan' : 'mellanstort flygplan'))
    const adj = big ? 'big' : 'small'
    const answer = String(big ? 1 : 0.4)
    const q4 = level >= 4
    return {
      id: `en.adjectives.bigSmall:${adj}:${scales.length}:${q4 ? 'q' : 't'}`,
      skill: 'en.adjectives',
      level,
      theme: 'airport',
      ...ask(level, support, {
        sv: `Tryck på ${adj}.`,
        en: q4 ? `Which plane is ${adj}?` : `Tap the ${adj} plane.`,
        say: adj,
      }),
      scene: showSign(level, support) ? wordSign(adj) : undefined,
      task: { kind: 'choice', choices, answer },
      hints: [
        gloss(adj, big ? 'stor' : 'liten', wordSign(adj)),
        { text: `Hitta det ${big ? 'största' : 'minsta'} flygplanet.`, eliminate: wrongIds(choices, answer) },
      ],
      success: `Ja! ${capitalize(adj)}.`,
    }
  },
}

const noun = (en: string) => NOUNS.find((n) => n.en === en)!
// Unambiguous pairs only: a jet or train is clearly faster than a bus or car.
const FAST = [noun('jet'), noun('train')]
const SLOW = [noun('bus'), noun('car')]

/** fast = jet or train, slow = bus or car (compared with each other). */
export const fastSlow: Generator = {
  id: 'en.adjectives.fastSlow',
  skill: 'en.adjectives',
  levels: [2, 5],
  generate({ rng, level, support }) {
    const fast = rng.next() < 0.5
    const f = rng.pick(FAST)
    const s = rng.pick(SLOW)
    const adj = fast ? 'fast' : 'slow'
    const t = fast ? f : s
    const choices = rng.shuffle([f, s]).map((x) => picChoice(x.en, x.sv, { sprite: x.sprite }))
    return {
      id: `en.adjectives.fastSlow:${adj}:${f.en}-${s.en}:${level >= 4 ? 'q' : 't'}`,
      skill: 'en.adjectives',
      level,
      theme: 'airport',
      ...ask(level, support, {
        sv: `Tryck på ${adj}.`,
        en: level >= 4 ? `Which vehicle is ${adj}?` : `Tap the ${adj} vehicle.`,
        say: adj,
      }),
      scene: showSign(level, support) ? wordSign(adj) : undefined,
      task: { kind: 'choice', choices, answer: t.en },
      hints: [
        { text: fast ? 'Vilken kommer fram först?' : 'Vilken kommer fram sist?' },
        gloss(adj, fast ? 'snabb' : 'långsam', wordSign(adj)),
      ],
      success: `Ja! ${capitalize(adj)}.`,
    }
  },
}
