import type { Choice, Generator, Scene } from '../../core/types'
import { wrongIds } from '../helpers'
import { MAX_BY_LEVEL, METRO_CARS, PASSENGERS, items, qty, type Thing } from './kit'

/** Two options (rows of things); ask which has most or fewest. */
const compare = (
  id: string,
  t: Thing,
  place: string,
  ask: (most: boolean) => string,
  ok: (most: boolean, n: number) => string,
): Generator => ({
  id: `math.compare.${id}`,
  skill: 'math.compare',
  levels: [1, 5],
  generate({ rng, level, support }) {
    const max = MAX_BY_LEVEL[level]
    const gap = level === 1 || support === 'extra' ? 2 : 1
    const hi = rng.int(1 + gap, max)
    const lo = rng.int(1, hi - gap)
    const [first, second] = rng.shuffle([hi, lo])
    const most = rng.next() < 0.7
    const answerN = most ? hi : lo
    const answer = first === answerN ? '1' : '2'
    const choice = (n: number, i: number): Choice => ({
      id: String(i),
      label: `${place} ${i}`,
      visual: { kind: 'row', items: items(t, n) },
      ariaLabel: `${place} ${i} med ${qty(t, n)}`,
    })
    const choices = [choice(first, 1), choice(second, 2)]
    const side: Scene = {
      kind: 'group',
      direction: 'column',
      scenes: [first, second].map((n) => ({ kind: 'row', items: items(t, n), label: `${qty(t, n)}` })),
    }
    return {
      id: `math.compare.${id}:${first}v${second}:${most ? 'most' : 'least'}`,
      skill: 'math.compare',
      level,
      theme: t.theme,
      prompt: ask(most),
      task: { kind: 'choice', choices, answer },
      hints: [
        { text: 'Ställ dem bredvid varandra och jämför.', scene: side },
        { text: `Räkna båda. Det ena är ${first} och det andra ${second}.`, eliminate: wrongIds(choices, answer, 2) },
      ],
      success: ok(most, answerN),
    }
  },
})

export const compareLongest = compare(
  'longestTrain',
  METRO_CARS,
  'Tåg',
  (m) => (m ? 'Vilket tåg är längst?' : 'Vilket tåg är kortast?'),
  (m, n) => `Ja! Det tåget har ${qty(METRO_CARS, n)}. ${m ? 'Det är längst.' : 'Det är kortast.'}`,
)
export const compareMostPassengers = compare(
  'passengers',
  PASSENGERS,
  'Perrong',
  (m) => (m ? 'Var finns flest resenärer?' : 'Var finns färre resenärer?'),
  (m, n) => `Ja! Där är det ${m ? 'fler' : 'färre'}: ${qty(PASSENGERS, n)}.`,
)
