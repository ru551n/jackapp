import type { Generator, SceneItem } from '../../core/types'
import { numberChoices, wrongIds } from '../helpers'
import { numberWord } from '../../core/swedish'

const row = (n: number, sprite: SceneItem['sprite'], grouped: boolean): SceneItem[] =>
  Array.from({ length: n }, (_, i) => ({ sprite, group: grouped ? Math.floor(i / 5) : 0 }))

/** "Hur många flygplan står på plattan?" Rows of up to 5 are grouped from level 3. */
export const countApron: Generator = {
  id: 'air.numbers.apron',
  skill: 'air.numbers',
  levels: [1, 5],
  generate({ rng, level, support }) {
    const max = level === 1 ? 5 : level === 2 ? 6 : level === 3 ? 10 : level === 4 ? 12 : 15
    const n = rng.int(2, max)
    const sprite = rng.pick(['airliner', 'jet'] as const)
    const name = sprite === 'jet' ? 'stridsflygplan' : 'passagerarflygplan'
    const grouped = support === 'extra' || level >= 3
    const choices = numberChoices(rng, n, support === 'extra' ? 2 : 3, 1, max + 1)
    return {
      id: `air.numbers.apron:${sprite}:${n}`,
      skill: 'air.numbers',
      level,
      theme: sprite === 'jet' ? 'fighter' : 'airport',
      prompt: 'Hur många flygplan står på plattan?',
      speech: 'Hur många flygplan står på plattan?',
      scene: { kind: 'row', items: row(n, sprite, grouped), label: `${n} ${name}` },
      task: { kind: 'choice', choices, answer: String(n) },
      hints: [
        { text: 'Peka på ett flygplan i taget och räkna.', scene: { kind: 'row', items: row(n, sprite, true) } },
        { text: `Det är ${numberWord(n)} flygplan.`, eliminate: wrongIds(choices, String(n)) },
      ],
      success: `Ja! Det är ${numberWord(n)} flygplan.`,
    }
  },
}

/** Boarding by seat row: tap the rows from the smallest number to the largest. */
export const boardingOrder: Generator = {
  id: 'air.numbers.boarding',
  skill: 'air.numbers',
  levels: [2, 5],
  generate({ rng, level, support }) {
    const max = level <= 3 ? 10 : 20
    const count = support === 'extra' || level === 2 ? 3 : level === 3 ? 4 : 5
    const rows = rng.shuffle(Array.from({ length: max }, (_, i) => i + 1)).slice(0, count)
    const items = rows.map((r) => ({ id: String(r), label: `Rad ${r}`, ariaLabel: `Rad ${r}` }))
    const sorted = [...rows].sort((a, b) => a - b)
    return {
      id: `air.numbers.boarding:${sorted.join('-')}`,
      skill: 'air.numbers',
      level,
      theme: 'airport',
      prompt: 'Passagerarna går ombord. Tryck på raderna, minst först.',
      scene: { kind: 'row', items: row(count, 'passenger', false), label: 'Passagerare i kö' },
      task: { kind: 'order', items, answer: sorted.map(String) },
      hints: [
        { text: `Börja med den minsta siffran. Det är ${sorted[0]}.` },
        { text: `Först rad ${sorted[0]}, sedan rad ${sorted[1]}.` },
      ],
      success: 'Ja! Alla passagerare sitter på rätt rad.',
    }
  },
}
