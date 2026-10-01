import type { Generator, Level, Scene } from '../../core/types'
import { choiceCount, numberChoices, wrongIds } from '../helpers'
import { MAX_BY_LEVEL, MIN_BY_LEVEL, METRO_CARS, items } from './kit'

const TOP = MAX_BY_LEVEL

/** Builds a sequence of `len` numbers with a hidden slot; returns the question pieces. */
function seq(level: Level, rng: Parameters<Generator['generate']>[0]['rng'], skip: boolean, short: boolean) {
  const len = level <= 2 || short ? 4 : 5
  const step = skip ? 2 : 1
  const down = level >= 4 && !skip && rng.next() < 0.6
  const span = step * (len - 1)
  const first = down
    ? rng.int(1 + span, TOP[level])
    : rng.int(Math.min(MIN_BY_LEVEL[level], TOP[level] - span), TOP[level] - span)
  const nums = Array.from({ length: len }, (_, i) => (down ? first - i * step : first + i * step))
  const hole = rng.int(1, len - 1) // keep the first number visible as a starting point
  return { nums, hole, step, down }
}

const make = (id: string, levels: [Level, Level], skip: boolean, carriages: boolean): Generator => ({
  id: `math.sequence.${id}`,
  skill: 'math.sequence',
  levels,
  generate({ rng, level, support }) {
    const { nums, hole, down } = seq(level, rng, skip, support === 'extra')
    const answer = nums[hole]
    // Extra support: a shorter sequence, with a car above every number.
    const cell = (v: number | '?'): Scene =>
      carriages || support === 'extra'
        ? {
            kind: 'group',
            direction: 'column',
            scenes: [
              { kind: 'row', items: items(METRO_CARS, 1) },
              carriages
                ? { kind: 'text', text: String(v), size: 'lg' }
                : { kind: 'sign', text: String(v), style: 'platform' },
            ],
          }
        : { kind: 'sign', text: String(v), style: 'platform' }
    const scene: Scene = {
      kind: 'group',
      direction: 'row',
      scenes: nums.map((v, i) => cell(i === hole ? '?' : v)),
    }
    const choices = numberChoices(rng, answer, choiceCount(level, support), 1, TOP[level])
    const word = carriages ? 'vagnarna' : 'perrongerna'
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
        {
          text: 'Titta på numret före och efter.',
          ...(choices.length > 2 && { eliminate: wrongIds(choices, String(answer)) }),
        },
      ],
      success: `Ja! Numret är ${answer}.`,
    }
  },
})

/** Platform (perrong) signs; counting backwards from level 4. */
export const sequencePlatforms = make('platforms', [1, 5], false, false)
/** Numbered cars. */
export const sequenceCars = make('carriages', [2, 5], false, true)
/** Counting by twos. */
export const sequenceSkip = make('skip', [4, 5], true, true)
