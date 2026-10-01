import { numberWord } from '../../core/swedish'
import type { Choice, Generator } from '../../core/types'
import { choiceCount, numberChoices, wrongIds } from '../helpers'
import {
  EXTRA_MAX,
  MAX_BY_LEVEL,
  METRO_CARS,
  MIN_BY_LEVEL,
  PASSENGERS,
  SUITCASES,
  grouped,
  qty,
  supportRow,
  type Thing,
} from './kit'

/** Counting by twos up to n: "två, fyra, sex". */
const byTwos = (n: number) =>
  Array.from({ length: Math.floor(n / 2) }, (_, i) => numberWord((i + 1) * 2)).join(', ') +
  (n % 2 ? ', och en till' : '')

const countThing = (
  id: string,
  t: Thing,
  theme: 'metro' | 'train',
  prompt: string,
  sceneLabel: string,
  done: (n: number) => string,
): Generator => ({
  id: `math.count.${id}`,
  skill: 'math.count',
  levels: [1, 5],
  generate({ rng, level, support }) {
    // Extra support: fewer items, grouped in pairs. The label never states the number.
    const max = support === 'extra' ? Math.min(MAX_BY_LEVEL[level], EXTRA_MAX) : MAX_BY_LEVEL[level]
    const n = rng.int(Math.min(MIN_BY_LEVEL[level], max), max)
    const row = { kind: 'row' as const, items: supportRow(t, n, support), label: sceneLabel }
    const choices = numberChoices(rng, n, choiceCount(level, support), 1, max)
    return {
      id: `math.count.${id}:${n}`,
      skill: 'math.count',
      level,
      theme,
      prompt,
      scene: row,
      task: { kind: 'choice', choices, answer: String(n) },
      hints: [
        { text: 'Peka och räkna igen. Ett par i taget.', scene: { ...row, items: grouped(t, n, 2) } },
        {
          text: `Räkna två i taget: ${byTwos(n)}.`,
          ...(choices.length > 2 && { eliminate: wrongIds(choices, String(n)) }),
        },
      ],
      success: done(n),
    }
  },
})

export const countMetroCars = countThing(
  'metroCars',
  METRO_CARS,
  'metro',
  'Hur många vagnar har tåget?',
  'Ett tunnelbanetåg',
  (n) => `Ja! Tåget har ${qty(METRO_CARS, n)}.`,
)
export const countPassengers = countThing(
  'passengers',
  PASSENGERS,
  'metro',
  'Hur många resenärer står på perrongen?',
  'Resenärer på perrongen',
  (n) => `Ja! Där står ${qty(PASSENGERS, n)}.`,
)
export const countSuitcases = countThing(
  'suitcases',
  SUITCASES,
  'train',
  'Hur många väskor ser du?',
  'Väskor på perrongen',
  (n) => `Ja! Det är ${qty(SUITCASES, n)}.`,
)

/** A platform sign shows a number; pick the train with that many cars. */
export const numberToTrain: Generator = {
  id: 'math.count.numberToTrain',
  skill: 'math.count',
  levels: [1, 5],
  generate({ rng, level, support }) {
    const max = support === 'extra' ? Math.min(MAX_BY_LEVEL[level], EXTRA_MAX) : MAX_BY_LEVEL[level]
    const n = rng.int(Math.min(MIN_BY_LEVEL[level], max), max)
    const choices = numberChoices(rng, n, choiceCount(level, support), 1, max).map((c): Choice => ({
      id: c.id,
      visual: { kind: 'row', items: supportRow(METRO_CARS, Number(c.id), support) },
      ariaLabel: `Tåg med ${qty(METRO_CARS, Number(c.id))}`,
    }))
    return {
      id: `math.count.numberToTrain:${n}`,
      skill: 'math.count',
      level,
      theme: 'metro',
      prompt: `Vilket tåg har ${n} vagnar?`,
      speech: `Vilket tåg har ${numberWord(n)} vagnar?`,
      scene: { kind: 'sign', text: String(n), style: 'platform' },
      task: { kind: 'choice', choices, answer: String(n) },
      hints: [
        { text: 'Peka och räkna vagnarna på varje tåg.' },
        {
          text: `Skylten visar ${n}. Räkna en vagn i taget. Vilket tåg stämmer?`,
          ...(choices.length > 2 && { eliminate: wrongIds(choices, String(n)) }),
        },
      ],
      success: `Ja! Det tåget har ${qty(METRO_CARS, n)}.`,
    }
  },
}
