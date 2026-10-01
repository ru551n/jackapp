import type { Generator, SceneItem } from '../../core/types'
import { capitalize, numberWord } from '../../core/swedish'
import { numberChoices, wrongIds } from '../helpers'
import { NUMBER_WORDS, VEHICLES, ask, enCount, gloss, row, showSign, svCount, swedishLevel, wordSign } from './vocab'

const items = (sprite: SceneItem['sprite'], n: number, grouped = false): SceneItem[] =>
  Array.from({ length: n }, (_, i) => ({ sprite, group: grouped ? Math.floor(i / 5) : undefined }))

/** Count vehicles. L1–2 Swedish prompt, L3 "How many trains?" (n ≥ 2), L4–5 answer with number words. */
export const howMany: Generator = {
  id: 'en.numbers.howMany',
  skill: 'en.numbers',
  levels: [1, 5],
  generate({ rng, level, support }) {
    const max = level <= 1 ? 3 : level <= 2 ? 5 : level === 3 ? 6 : 10
    const min = swedishLevel(level, support) ? 1 : 2
    const n = rng.int(min, max)
    const v = rng.pick(VEHICLES)
    const words = level >= 4 && support !== 'extra'
    const choices = numberChoices(rng, n, level <= 1 ? 2 : 3, min, max).map((c) => ({
      id: c.id,
      label: words ? NUMBER_WORDS[Number(c.id)] : c.label,
      lang: words ? ('en' as const) : undefined,
    }))
    return {
      id: `en.numbers.howMany:${v.en}:${n}:${words ? 'w' : 'n'}`,
      skill: 'en.numbers',
      level,
      theme: v.theme,
      ...ask(level, support, {
        sv: 'Hur många är det?',
        en: `How many ${v.plural}?`,
        speech: 'Hur många är det?',
      }),
      scene: row(...items(v.sprite, n)),
      task: { kind: 'choice', choices, answer: String(n) },
      hints: [
        { text: 'Räkna ett i taget.', scene: row(...items(v.sprite, n, true)) },
        {
          text: `Det är ${svCount(n, v)}.`,
          eliminate: wrongIds(choices, String(n)),
          listen: { text: enCount(n, v), lang: 'en' },
        },
      ],
      success: `Ja! ${capitalize(enCount(n, v))}.`,
    }
  },
}

/** Number word ↔ numeral: "three" → 3 (L1–3), "3" → three (L4–5). */
export const wordToNumeral: Generator = {
  id: 'en.numbers.wordToNumeral',
  skill: 'en.numbers',
  levels: [1, 5],
  generate({ rng, level, support }) {
    const max = level <= 2 ? 5 : 10
    const n = rng.int(1, max)
    const reverse = level >= 4
    const count = level <= 1 ? 2 : 3
    const choices = numberChoices(rng, n, count, 1, max).map((c) => ({
      id: c.id,
      label: reverse ? NUMBER_WORDS[Number(c.id)] : c.label,
      lang: reverse ? ('en' as const) : undefined,
    }))
    const w = NUMBER_WORDS[n]
    const jets = row(...items('jet', n, true))
    return {
      id: `en.numbers.wordToNumeral:${n}:${reverse ? 'r' : 'f'}`,
      skill: 'en.numbers',
      level,
      theme: 'airport',
      ...ask(level, support, {
        sv: reverse ? `Vilket ord är ${n}?` : `Vilket tal är ${w}?`,
        en: reverse ? `Which word is ${n}?` : `Which number is ${w}?`,
        say: reverse ? undefined : w,
        speech: reverse ? 'Vilket ord är det?' : 'Vilket tal är det?',
      }),
      scene: reverse ? { kind: 'number', value: n } : showSign(level, support) ? wordSign(w) : undefined,
      task: { kind: 'choice', choices, answer: String(n) },
      hints: [
        reverse
          ? { text: `Talet är ${numberWord(n)}.`, scene: jets, listen: { text: w, lang: 'en' } }
          : gloss(w, numberWord(n), jets),
        { text: 'Ta bort några svar.', eliminate: wrongIds(choices, String(n)) },
      ],
      success: `Ja! ${capitalize(w)} = ${n}.`,
    }
  },
}
