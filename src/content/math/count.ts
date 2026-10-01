import { numberWord } from '../../core/swedish'
import type { Choice, Generator, Level } from '../../core/types'
import { numberChoices, wrongIds } from '../helpers'
import { METRO_CARS, PASSENGERS, SUITCASES, grouped, items, MAX_BY_LEVEL, qty, type Thing } from './kit'

const countThing = (
  id: string,
  t: Thing,
  theme: 'metro' | 'train',
  prompt: string,
  sceneLabel: (n: number) => string,
  done: (n: number) => string,
): Generator => ({
  id: `math.count.${id}`,
  skill: 'math.count',
  levels: [1, 5],
  generate({ rng, level, support }) {
    const max = MAX_BY_LEVEL[level]
    const n = rng.int(level === 1 ? 2 : 3, max)
    // Extra support: split into groups of two so they are easier to keep track of.
    const row = {
      kind: 'row' as const,
      items: support === 'extra' ? grouped(t, n, 2) : items(t, n),
      label: sceneLabel(n),
    }
    const choices = numberChoices(rng, n, support === 'extra' || level === 1 ? 2 : 3, 1, max)
    return {
      id: `math.count.${id}:${n}`,
      skill: 'math.count',
      level,
      theme,
      prompt,
      scene: row,
      task: { kind: 'choice', choices, answer: String(n) },
      hints: [
        { text: 'Peka på en i taget och räkna högt.', scene: { ...row, items: grouped(t, n, 2) } },
        { text: 'Räkna två i taget.', eliminate: wrongIds(choices, String(n)) },
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
  (n) => `Ett tunnelbanetåg med ${n} vagnar`,
  (n) => `Ja! Tåget har ${numberWord(n, 'en')} ${n === 1 ? 'vagn' : 'vagnar'}.`,
)
export const countPassengers = countThing(
  'passengers',
  PASSENGERS,
  'metro',
  'Hur många resenärer står på plattan?',
  (n) => `${n} resenärer på plattan`,
  (n) => `Ja! Där står ${qty(PASSENGERS, n)}.`,
)
export const countSuitcases = countThing(
  'suitcases',
  SUITCASES,
  'train',
  'Hur många väskor ser du?',
  (n) => `${n} väskor på plattformen`,
  (n) => `Ja! Det är ${qty(SUITCASES, n)}.`,
)

/** A platform sign shows a number; pick the train with that many cars. */
export const numberToTrain: Generator = {
  id: 'math.count.numberToTrain',
  skill: 'math.count',
  levels: [1, 5],
  generate({ rng, level, support }) {
    const max = MAX_BY_LEVEL[level as Level]
    const n = rng.int(2, max)
    const choices = numberChoices(rng, n, support === 'extra' || level === 1 ? 2 : 3, 1, max).map((c): Choice => ({
      id: c.id,
      visual: { kind: 'row', items: items(METRO_CARS, Number(c.id)) },
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
        { text: 'Räkna vagnarna på varje tåg.' },
        { text: 'Räkna en vagn i taget. Vilket tåg stämmer?', eliminate: wrongIds(choices, String(n)) },
      ],
      success: `Ja! Det tåget har ${qty(METRO_CARS, n)}.`,
    }
  },
}
