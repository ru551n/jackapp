import type { Choice, Rng, Tint } from '../core/types'

/** Swedish colour adjectives: "en röd spårvagn" / "den röda spårvagnen". */
export const TINT_NAMES: Record<Tint, { indef: string; def: string }> = {
  red: { indef: 'röd', def: 'röda' },
  blue: { indef: 'blå', def: 'blå' },
  green: { indef: 'grön', def: 'gröna' },
  yellow: { indef: 'gul', def: 'gula' },
  grey: { indef: 'grå', def: 'grå' },
}

/**
 * `count` numeric choices including `answer`, all within [min, max], close to the answer
 * (nearby distractors are more meaningful than random ones). Sorted ascending for predictability.
 */
export function numberChoices(rng: Rng, answer: number, count: number, min: number, max: number): Choice[] {
  const pool = new Set<number>([answer])
  for (let d = 1; pool.size < count && d <= max - min; d++) {
    for (const v of rng.shuffle([answer - d, answer + d])) {
      if (pool.size < count && v >= min && v <= max) pool.add(v)
    }
  }
  return [...pool].sort((a, b) => a - b).map((v) => ({ id: String(v), label: String(v) }))
}

/** Text choices: answer plus distinct distractors, shuffled. */
export function textChoices(rng: Rng, answer: string, distractors: readonly string[], count: number): Choice[] {
  const others = rng.shuffle(distractors.filter((d) => d !== answer)).slice(0, count - 1)
  return rng.shuffle([answer, ...others]).map((t) => ({ id: t, label: t }))
}

/** Ids of wrong choices to eliminate in a hint (keeps at least `keepWrong` wrong options). */
export function wrongIds(choices: Choice[], answer: string, keepWrong = 1): string[] {
  const wrong = choices.map((c) => c.id).filter((id) => id !== answer)
  return wrong.slice(0, Math.max(0, wrong.length - keepWrong))
}

/** Shared choice-count ladder: 2 options at level 1 or with extra support, 3 at levels 2–3, 4 above. */
export const choiceCount = (level: number, support: 'normal' | 'extra'): number =>
  support === 'extra' || level <= 1 ? 2 : level <= 3 ? 3 : 4
