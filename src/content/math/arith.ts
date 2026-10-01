import { numberWord } from '../../core/swedish'
import type { Generator, Level, Question, Scene } from '../../core/types'
import { choiceCount, numberChoices, wrongIds } from '../helpers'
import { CARRIAGES, MAX_BY_LEVEL, PASSENGERS, PLANES, Qty, items, qty, type Thing } from './kit'

type Op = 'add' | 'sub'

interface Story {
  key: string
  thing: Thing
  /** Prompt for the situation, ending in the question. */
  story: (a: number, b: number) => string
  done: (n: number) => string
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const upTo = (from: number, n: number, step: 1 | -1) =>
  Array.from({ length: n }, (_, i) => from + step * (i + 1)).join(', ')

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
      `${Qty(PASSENGERS, a)} väntar på perrongen. ${Qty(PASSENGERS, b)} kliver på. Hur många resenärer är det nu?`,
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

/**
 * Presentation per level (same numeric range with or without extra support):
 * L1 pictures, L2 pictures + numbers, L3 pictures + equation, L4 equation + pictures,
 * L5 equation + count-on aid (extra support: full pictures + equation).
 */
type Form = 'pics' | 'nums' | 'pic-eq' | 'eq-pic' | 'eq-aid'
const FORMS: Record<Level, Form> = { 1: 'pics', 2: 'nums', 3: 'pic-eq', 4: 'eq-pic', 5: 'eq-aid' }

function build(op: Op, s: Story, { rng, level, support }: Parameters<Generator['generate']>[0]): Question {
  const extra = support === 'extra'
  const max = MAX_BY_LEVEL[level]
  const total = rng.int(level + 2, max) // sum (add) or start (sub)
  const b = rng.int(1, Math.min(total - 2, level === 5 ? 6 : 5)) // keeps a >= 2 and answer >= 2
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
  // Light aid: the first term as a number, the second as pictures to count on / back.
  const aid: Scene = {
    kind: 'group',
    direction: 'row',
    scenes: [
      num(a),
      { kind: 'text', text: sign },
      { kind: 'row', items: items(t, b, op === 'add' ? 'arriving' : 'leaving', 1) },
    ],
  }

  const form: Form = extra && level === 5 ? 'pic-eq' : FORMS[level]
  const scenes: Record<Form, Scene> = {
    pics,
    nums: withNumbers,
    'pic-eq': { kind: 'group', direction: 'column', scenes: [pics, equation] },
    'eq-pic': { kind: 'group', direction: 'column', scenes: [equation, pics] },
    'eq-aid': { kind: 'group', direction: 'column', scenes: [equation, aid] },
  }

  const symbolic = form === 'eq-aid'
  const spoken = `${numberWord(a, 'ett')} ${op === 'add' ? 'plus' : 'minus'} ${numberWord(b, 'ett')}`
  const choices = numberChoices(rng, answer, choiceCount(level, support), 1, max)
  const cue =
    op === 'add'
      ? `Börja på ${a} och räkna vidare: ${upTo(a, b, 1)}.`
      : `Börja på ${a} och räkna bakåt: ${upTo(a, b, -1)}.`
  const hintScene: Scene =
    op === 'add'
      ? { kind: 'row', items: [...items(t, a, undefined, 0), ...items(t, b, 'arriving', 1)] }
      : { kind: 'row', items: items(t, answer) }

  return {
    id: `math.${op}.${s.key}:${a}${sign}${b}:${form}`,
    skill: op === 'add' ? 'math.add' : 'math.sub',
    level,
    theme: t.theme,
    prompt: symbolic ? `Hur mycket blir ${a} ${sign} ${b}?` : s.story(a, b),
    speech: symbolic ? `Hur mycket blir ${spoken}?` : undefined,
    scene: scenes[form],
    task: { kind: 'choice', choices, answer: String(answer) },
    hints: [
      {
        text: `${op === 'add' ? 'Titta på alla tillsammans.' : 'Titta på dem som är kvar.'} ${cue}`,
        scene: hintScene,
      },
      {
        text: `${cap(spoken)}. ${a}, ${op === 'add' ? upTo(a, b, 1) : upTo(a, b, -1)}. Det blir ${answer}.`,
        // only with 3+ choices; never implies something was taken away
        ...(choices.length > 2 && { eliminate: wrongIds(choices, String(answer)) }),
      },
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
