import { numberWord } from '../../core/swedish'
import type { Generator, Level, Question, Scene } from '../../core/types'
import { numberChoices, wrongIds } from '../helpers'
import { CARRIAGES, PASSENGERS, PLANES, Qty, grouped, items, qty, type Thing } from './kit'

type Op = 'add' | 'sub'

interface Story {
  key: string
  thing: Thing
  /** Prompt for the situation, ending in the question. */
  story: (a: number, b: number) => string
  done: (n: number) => string
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const ADD: Story[] = [
  {
    key: 'carriages',
    thing: CARRIAGES,
    story: (a, b) =>
      `${Qty(CARRIAGES, a)} står på stationen. ${Qty(CARRIAGES, b)} kopplas på. Hur många vagnar har tåget nu?`,
    done: (n) => `Ja! Tåget har ${qty(CARRIAGES, n)}.`,
  },
  {
    key: 'passengers',
    thing: PASSENGERS,
    story: (a, b) =>
      `${Qty(PASSENGERS, a)} väntar på plattan. ${Qty(PASSENGERS, b)} kliver på. Hur många resenärer är det nu?`,
    done: (n) => `Ja! Nu är det ${qty(PASSENGERS, n)}.`,
  },
  {
    key: 'planes',
    thing: PLANES,
    story: (a, b) =>
      `${Qty(PLANES, a)} står på plattan. ${b === 1 ? 'Ett till landar' : `${Qty(PLANES, b)} landar`}. Hur många flygplan står där nu?`,
    done: (n) => `Ja! Nu står ${qty(PLANES, n)} på plattan.`,
  },
]

const SUB: Story[] = [
  {
    key: 'carriages',
    thing: CARRIAGES,
    story: (a, b) => `Tåget har ${qty(CARRIAGES, a)}. ${Qty(CARRIAGES, b)} kopplas loss. Hur många vagnar är kvar?`,
    done: (n) => `Ja! Tåget har ${qty(CARRIAGES, n)} kvar.`,
  },
  {
    key: 'passengers',
    thing: PASSENGERS,
    story: (a, b) =>
      `${Qty(PASSENGERS, a)} åker tunnelbana. ${Qty(PASSENGERS, b)} kliver av. Hur många resenärer är kvar?`,
    done: (n) => `Ja! ${Qty(PASSENGERS, n)} är kvar.`,
  },
  {
    key: 'planes',
    thing: PLANES,
    story: (a, b) => `${Qty(PLANES, a)} står på plattan. ${Qty(PLANES, b)} lyfter. Hur många flygplan är kvar?`,
    done: (n) => `Ja! ${Qty(PLANES, n)} står kvar.`,
  },
]

/** Largest total (add) / starting quantity (sub) per level. */
const LIMIT: Record<Level, number> = { 1: 5, 2: 6, 3: 10, 4: 10, 5: 20 }

function build(op: Op, s: Story, { rng, level, support }: Parameters<Generator['generate']>[0]): Question {
  const extra = support === 'extra'
  const max = level === 5 && extra ? 10 : LIMIT[level]
  const total = rng.int(level === 1 ? 3 : 4, max) // sum (add) or start (sub)
  const b = rng.int(1, Math.min(total - 1, level === 5 ? 9 : 5))
  const a = op === 'add' ? total - b : total
  const answer = op === 'add' ? total : total - b
  const sign = op === 'add' ? '+' : '−'
  const t = s.thing

  const pics: Scene = {
    kind: 'row',
    items:
      op === 'add'
        ? [...items(t, a, undefined, 0), ...items(t, b, 'arriving', 1)]
        : [...items(t, a - b, undefined, 0), ...items(t, b, 'leaving', 1)],
    label: op === 'add' ? `${Qty(t, a)} och ${qty(t, b)} till` : `${Qty(t, a)}, varav ${qty(t, b)} lämnar`,
  }
  const equation: Scene = { kind: 'equation', terms: [a, sign, b, '=', '?'] }
  const num = (value: number): Scene => ({ kind: 'number', value })
  const withNumbers: Scene =
    op === 'add'
      ? {
          kind: 'group',
          direction: 'row',
          scenes: [
            { kind: 'group', direction: 'column', scenes: [{ kind: 'row', items: items(t, a, undefined, 0) }, num(a)] },
            {
              kind: 'group',
              direction: 'column',
              scenes: [{ kind: 'row', items: items(t, b, 'arriving', 1) }, num(b)],
            },
          ],
        }
      : {
          kind: 'group',
          direction: 'column',
          scenes: [pics, { kind: 'group', direction: 'row', scenes: [num(a), { kind: 'text', text: '−' }, num(b)] }],
        }

  // Picture -> symbol progression. Extra support always brings pictures back.
  const lvl = extra && level >= 4 ? 3 : level
  const scene: Scene =
    lvl <= 1
      ? pics
      : lvl === 2
        ? withNumbers
        : lvl === 3
          ? { kind: 'group', direction: 'column', scenes: [pics, equation] }
          : equation

  const symbolic = level === 5 && !extra
  const spoken = `${numberWord(a, 'ett')} ${op === 'add' ? 'plus' : 'minus'} ${numberWord(b, 'ett')}`
  const choices = numberChoices(rng, answer, level === 1 || extra ? 2 : 3, 1, Math.max(max, answer + 1))
  const hintScene: Scene =
    op === 'add'
      ? { kind: 'row', items: grouped(t, total, total <= 6 ? 2 : 5), label: `Tillsammans ${qty(t, total)}` }
      : { kind: 'row', items: items(t, answer), label: `${Qty(t, answer)} kvar` }

  return {
    id: `math.${op}.${s.key}:${a}${sign}${b}:L${level}`,
    skill: op === 'add' ? 'math.add' : 'math.sub',
    level,
    theme: t.theme,
    prompt: symbolic ? `Hur mycket är ${a} ${sign} ${b}?` : s.story(a, b),
    speech: symbolic ? `Hur mycket är ${spoken}?` : undefined,
    scene,
    task: { kind: 'choice', choices, answer: String(answer) },
    hints: [
      {
        text: op === 'add' ? 'Titta på alla tillsammans. Räkna dem.' : 'Titta på dem som är kvar. Räkna dem.',
        scene: hintScene,
      },
      { text: `Räkna en i taget. ${cap(spoken)} är…`, eliminate: wrongIds(choices, String(answer)) },
    ],
    success: s.done(answer),
  }
}

const make = (op: Op, s: Story): Generator => ({
  id: `math.${op}.${s.key}`,
  skill: op === 'add' ? 'math.add' : 'math.sub',
  levels: [1, 5],
  generate: (ctx) => build(op, s, ctx),
})

export const ADD_GENERATORS = ADD.map((s) => make('add', s))
export const SUB_GENERATORS = SUB.map((s) => make('sub', s))
