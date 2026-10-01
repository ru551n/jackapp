import type { Generator, Level, Scene } from '../../core/types'
import { numberChoices, wrongIds } from '../helpers'
import { METRO_CARS, items } from './kit'

const TOP: Record<Level, number> = { 1: 5, 2: 6, 3: 10, 4: 10, 5: 20 }

/** Builds a sequence of `len` numbers with a hidden slot; returns the question pieces. */
function seq(level: Level, rng: Parameters<Generator['generate']>[0]['rng'], skip: boolean) {
  const len = level <= 2 ? 4 : 5
  const step = skip ? 2 : 1
  const down = level >= 4 && !skip && rng.next() < 0.6
  const span = step * (len - 1)
  const first = down ? rng.int(1 + span, TOP[level]) : rng.int(1, TOP[level] - span)
  const nums = Array.from({ length: len }, (_, i) => (down ? first - i * step : first + i * step))
  const hole = rng.int(1, len - 1) // keep the first number visible as a starting point
  return { nums, hole, step, down }
}

const make = (id: string, levels: [Level, Level], skip: boolean, carriages: boolean): Generator => ({
  id: `math.sequence.${id}`,
  skill: 'math.sequence',
  levels,
  generate({ rng, level, support }) {
    const { nums, hole, down } = seq(level, rng, skip)
    const answer = nums[hole]
    const cell = (v: number | '?'): Scene =>
      carriages
        ? {
            kind: 'group',
            direction: 'column',
            scenes: [
              { kind: 'row', items: items(METRO_CARS, 1) },
              { kind: 'text', text: String(v), size: 'lg' },
            ],
          }
        : { kind: 'sign', text: String(v), style: 'platform' }
    const scene: Scene = {
      kind: 'group',
      direction: 'row',
      scenes: nums.map((v, i) => cell(i === hole ? '?' : v)),
    }
    const choices = numberChoices(rng, answer, level === 1 || support === 'extra' ? 2 : 3, 1, TOP[level])
    const word = carriages ? 'vagnarna' : 'plattformarna'
    return {
      id: `math.sequence.${id}:${nums.map((v, i) => (i === hole ? '_' : v)).join(',')}`,
      skill: 'math.sequence',
      level,
      theme: carriages ? 'metro' : 'train',
      prompt: skip ? `Vilket nummer saknas? Vi räknar två och två.` : `Vilket nummer saknas på ${word}?`,
      scene,
      task: { kind: 'choice', choices, answer: String(answer) },
      hints: [
        {
          text: down ? 'Räkna baklänges. Det blir ett mindre varje gång.' : 'Räkna högt från det första numret.',
          scene: { kind: 'group', direction: 'row', scenes: nums.map((v) => cell(v)) },
        },
        { text: 'Titta på numret före och efter.', eliminate: wrongIds(choices, String(answer)) },
      ],
      success: `Ja! Numret är ${answer}.`,
    }
  },
})

/** Platform signs; counting backwards from level 4. */
export const sequencePlatforms = make('platforms', [1, 5], false, false)
/** Numbered cars. */
export const sequenceCars = make('carriages', [2, 5], false, true)
/** Counting by twos. */
export const sequenceSkip = make('skip', [4, 5], true, true)
