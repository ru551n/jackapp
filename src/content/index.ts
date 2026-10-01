import type { Generator, SkillId } from '../core/types'
import { AVIATION_GENERATORS } from './aviation'
import { ENGLISH_GENERATORS } from './english'
import { LOGIC_GENERATORS } from './logic'
import { MATH_GENERATORS } from './math'
import { READING_GENERATORS } from './reading'

/**
 * The static content provider: every activity generator in the app. A future provider (e.g.
 * generated content) only needs to supply more Generator objects; the engine is unchanged.
 */
export const GENERATORS: Generator[] = [
  ...READING_GENERATORS,
  ...MATH_GENERATORS,
  ...LOGIC_GENERATORS,
  ...AVIATION_GENERATORS,
  ...ENGLISH_GENERATORS,
]

export const AVAILABLE_SKILLS: SkillId[] = [...new Set(GENERATORS.map((g) => g.skill))]
