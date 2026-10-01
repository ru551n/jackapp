import type { Generator } from '../../core/types'
import { ADD_GENERATORS, SUB_GENERATORS } from './arith'
import { compareLongest, compareMostPassengers } from './compare'
import { countMetroCars, countPassengers, countSuitcases, numberToTrain } from './count'
import { oneLess, oneMore } from './oneMoreLess'
import { sequenceCars, sequencePlatforms, sequenceSkip } from './sequence'

export const MATH_GENERATORS: Generator[] = [
  countMetroCars,
  countPassengers,
  countSuitcases,
  numberToTrain,
  compareLongest,
  compareMostPassengers,
  oneMore,
  oneLess,
  sequencePlatforms,
  sequenceCars,
  sequenceSkip,
  ...ADD_GENERATORS,
  ...SUB_GENERATORS,
]
