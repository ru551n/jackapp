import type { Choice, Rng, Vehicle } from '../../core/types'
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

/** Stable question id content: topic, answer and the sorted option ids. */
export const qid = (skill: string, topic: string, answer: string, options: string[]) =>
  `${skill}:${topic}:${answer}:${[...options].sort().join('+')}`

/** Short, child-friendly pointer to something visible on the drawing. */
export const FEATURE: Record<string, string> = {
  gripen: 'Gripen har små vingar längst fram och en stor trekantig vinge bak.',
  viggen: 'Viggen har vingar både fram och bak.',
  draken: 'Drakens vingar är som en dubbel triangel.',
  f16: 'F-16 har vingar med rak kant bak och en motor.',
  fa18: 'F/A-18 har två stjärtfenor som lutar utåt.',
  f15: 'F-15 har stora vingar och två höga stjärtfenor.',
  typhoon: 'Typhoon har små vingar längst fram och två motorer.',
  rafale: 'Rafale har små vingar nära de stora vingarna och två motorer.',
  a320: 'A320 har två motorer under vingarna.',
  b737: 'Boeing 737 har två motorer under vingarna.',
  a380: 'A380 är jättestor och har fyra motorer.',
  saab340: 'Saab 340 har raka vingar och två propellrar.',
}
