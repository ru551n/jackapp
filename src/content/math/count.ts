import { numberWord } from '../../core/swedish'
import type { Generator, Level, SceneItem } from '../../core/types'
import { numberChoices, wrongIds } from '../helpers'

const MAX_BY_LEVEL: Record<Level, number> = { 1: 4, 2: 6, 3: 8, 4: 10, 5: 12 }

/** "Hur många vagnar har tåget?" — count metro cars in a row. */
export const countMetroCars: Generator = {
  id: 'math.count.metroCars',
  skill: 'math.count',
  levels: [1, 5],
  generate({ rng, level, support }) {
    const n = rng.int(level === 1 ? 2 : 3, MAX_BY_LEVEL[level])
    const cars: SceneItem[] = Array.from({ length: n }, () => ({ sprite: 'metroCar' }))
    // Extra support: split into groups of two so the cars are easier to keep track of.
    const grouped = cars.map((c, i) => ({ ...c, group: Math.floor(i / 2) }))
    const choices = numberChoices(rng, n, support === 'extra' ? 2 : 3, 1, MAX_BY_LEVEL[level])
    return {
      id: `math.count.metroCars:${n}`,
      skill: 'math.count',
      level,
      theme: 'metro',
      prompt: 'Hur många vagnar har tåget?',
      scene: { kind: 'row', items: support === 'extra' ? grouped : cars, label: `Ett tunnelbanetåg med ${n} vagnar` },
      task: { kind: 'choice', choices, answer: String(n) },
      hints: [
        { text: 'Peka på varje vagn och räkna högt.', scene: { kind: 'row', items: grouped } },
        { text: 'Räkna två vagnar i taget.', eliminate: wrongIds(choices, String(n)) },
      ],
      success: `Ja! Tåget har ${numberWord(n, 'en')} ${n === 1 ? 'vagn' : 'vagnar'}.`,
    }
  },
}
