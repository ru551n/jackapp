import type { Generator } from '../../core/types'
import { countApron, boardingOrder } from './apron'
import { compareEngines, compareFirstFlight, compareLength, compareSize } from './compare'
import { findGate } from './gate'
import { readDestination, readName, readSentence } from './read'
import { recognizeAirliner, recognizeName, recognizeShadow, recognizeSwedish } from './recognize'

export const AVIATION_GENERATORS: Generator[] = [
  recognizeName,
  recognizeSwedish,
  recognizeAirliner,
  recognizeShadow,
  readName,
  readDestination,
  readSentence,
  findGate,
  countApron,
  boardingOrder,
  compareSize,
  compareEngines,
  compareLength,
  compareFirstFlight,
]
