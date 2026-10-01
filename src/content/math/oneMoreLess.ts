import { numberWord } from '../../core/swedish'
import type { Generator, Scene } from '../../core/types'
import { choiceCount, numberChoices, wrongIds } from '../helpers'
import {
  CARRIAGES,
  EXTRA_MAX,
  MAX_BY_LEVEL,
  MIN_BY_LEVEL,
  PASSENGERS,
  Qty,
  grouped,
  items,
  qty,
  type Thing,
} from './kit'

interface Variant {
  thing: Thing
  start: (n: number) => string
  more: string
  less: string
}

const VARIANTS: Variant[] = [
  {
    thing: CARRIAGES,
    start: (n) => `Tåget har ${qty(CARRIAGES, n)}.`,
    more: 'En vagn kopplas på.',
    less: 'En vagn kopplas loss.',
  },
  {
    thing: PASSENGERS,
    start: (n) => `${Qty(PASSENGERS, n)} väntar på perrongen.`,
    more: 'En resenär kommer till.',
    less: 'En resenär går.',
  },
]

const make = (dir: 'more' | 'less'): Generator => ({
  id: `math.oneMoreLess.${dir}`,
  skill: 'math.oneMoreLess',
  levels: [1, 5],
  generate({ rng, level, support }) {
    const v = rng.pick(VARIANTS)
    const t = v.thing
    const max = support === 'extra' ? Math.min(MAX_BY_LEVEL[level], EXTRA_MAX) : MAX_BY_LEVEL[level]
    const min = Math.min(MIN_BY_LEVEL[level], max - 1)
    const delta = dir === 'more' ? 1 : -1
    const n = dir === 'more' ? rng.int(min, max - 1) : rng.int(min, max)
    const answer = n + delta
    const symbolic = level >= 4 && support !== 'extra' && rng.next() < 0.5
    const pics: Scene = {
      kind: 'row',
      items:
        dir === 'more'
          ? [...items(t, n, undefined, 0), ...items(t, 1, 'arriving', 1)]
          : [...items(t, n - 1, undefined, 0), ...items(t, 1, 'leaving', 1)],
      label: dir === 'more' ? `${Qty(t, n)} och en till` : `${Qty(t, n)}, en lämnar`,
    }
    const choices = numberChoices(rng, answer, choiceCount(level, support), 1, max)
    return {
      id: `math.oneMoreLess.${symbolic ? 'number' : dir}.${t.many}:${n}->${answer}`,
      skill: 'math.oneMoreLess',
      level,
      theme: t.theme,
      prompt: symbolic
        ? `Vilket tal är ett ${dir === 'more' ? 'mer' : 'mindre'} än ${n}?`
        : `${v.start(n)} ${dir === 'more' ? v.more : v.less} Hur många nu?`,
      speech: symbolic ? `Vilket tal är ett ${dir === 'more' ? 'mer' : 'mindre'} än ${numberWord(n)}?` : undefined,
      scene: symbolic
        ? { kind: 'number', value: n }
        : support === 'extra'
          ? { kind: 'group', direction: 'column', scenes: [pics, { kind: 'number', value: n }] } // number label under the start
          : pics,
      task: { kind: 'choice', choices, answer: String(answer) },
      hints: [
        {
          text: dir === 'more' ? 'Räkna alla, även den nya.' : 'Räkna dem som är kvar.',
          scene: {
            kind: 'row',
            items: dir === 'more' ? grouped(t, answer, 2) : items(t, answer),
          },
        },
        {
          text: `Börja på ${n}. ${dir === 'more' ? 'Ett mer' : 'Ett mindre'} är ${answer}.`,
          ...(choices.length > 2 && { eliminate: wrongIds(choices, String(answer)) }),
        },
      ],
      success: `Ja! Nu är det ${qty(t, answer)}.`,
    }
  },
})

export const oneMore = make('more')
export const oneLess = make('less')
