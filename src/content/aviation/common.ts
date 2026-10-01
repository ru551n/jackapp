import type { Choice, Hint, Rng, Vehicle } from '../../core/types'
import { wrongIds } from '../helpers'
import { AIRCRAFT } from '../vehicles/aircraft'

export const FIGHTERS = AIRCRAFT.filter((v) => v.category === 'fighter')
export const AIRLINERS = AIRCRAFT.filter((v) => v.category === 'airliner')

/** A picture choice (aircraft art or silhouette). ariaLabel stays generic so it never gives the answer away. */
export const pictureChoice = (v: Vehicle, n: number, view?: 'silhouette', label?: string): Choice => ({
  id: v.id,
  visual: { kind: 'vehicle', vehicle: v.id, view },
  label,
  ariaLabel: `Flygplan ${n + 1}`,
})

/** `answer` plus `count - 1` distractors from `pool`, shuffled. */
export function pickAmong(rng: Rng, answer: Vehicle, pool: readonly Vehicle[], count: number): Vehicle[] {
  const others = rng.shuffle(pool.filter((v) => v.id !== answer.id)).slice(0, count - 1)
  return rng.shuffle([answer, ...others])
}

/** Aircraft a 7-year-old is likely to know by name (used at level 1). */
export const KNOWN = ['gripen', 'viggen', 'draken', 'a380']

/** Pairs whose drawings are easy to mix up: never offered together where shapes alone must tell them apart. */
export const NEAR: readonly [string, string][] = [
  ['a320', 'b737'],
  ['gripen', 'typhoon'],
  ['typhoon', 'rafale'],
  ['gripen', 'viggen'],
  ['fa18', 'f15'],
]
export const isNear = (a: string, b: string) => NEAR.some(([x, y]) => (x === a && y === b) || (x === b && y === a))

/** Like pickAmong, but no two options look alike. Prefers `pool`, tops up from all aircraft. */
export function pickDistinct(rng: Rng, answer: Vehicle, pool: readonly Vehicle[], count: number): Vehicle[] {
  const rest = AIRCRAFT.filter((v) => !pool.includes(v))
  const picked = [answer]
  for (const v of [...rng.shuffle(pool), ...rng.shuffle(rest)]) {
    if (picked.length < count && !picked.some((p) => p.id === v.id || isNear(p.id, v.id))) picked.push(v)
  }
  return rng.shuffle(picked)
}

/**
 * Two hints that scaffold from the first miss: `pointer` says what to look for (and drops wrong choices when
 * there are 3+ options); `reveal` names the answer without claiming to remove anything.
 */
export const hintPair = (choices: Choice[], answer: string, pointer: string, reveal: string): Hint[] => {
  const eliminate = wrongIds(choices, answer)
  return [{ text: pointer, ...(eliminate.length ? { eliminate } : {}) }, { text: reveal }]
}

/** Stable question id content: topic, answer and the sorted option ids. */
export const qid = (skill: string, topic: string, answer: string, options: string[]) =>
  `${skill}:${topic}:${answer}:${[...options].sort().join('+')}`

/** Short, child-friendly pointer to something visible on the drawing. */
export const FEATURE: Record<string, string> = {
  gripen: 'Gripen har små vingar längst fram, en stor trekantig vinge och en motor bak.',
  viggen: 'Viggen har stora vingar både fram och bak.',
  draken: 'Drakens vinge har en knick: först smal, sedan bred, som en dubbel triangel.',
  f16: 'F-16 har vingar med rak kant bak och en motor.',
  fa18: 'F/A-18 har spetsiga vingförlängningar fram och två stjärtfenor.',
  f15: 'F-15 har breda vingar och två höga stjärtfenor.',
  typhoon: 'Typhoon har små vingar långt fram och två motorer bak.',
  rafale: 'Rafale har små vingar tätt framför de stora vingarna och två motorer bak.',
  a320: 'A320 har smala motorer långt ut på vingarna som pekar bakåt.',
  b737: 'Boeing 737 har tjocka motorer nära kroppen och korta vingar.',
  a380: 'A380 är jättestor och har fyra motorer.',
  saab340: 'Saab 340 har raka vingar och två propellrar.',
}
