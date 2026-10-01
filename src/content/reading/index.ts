import type { Generator } from '../../core/types'
import { matchLetter, platformLetter, startsWith } from './letters'
import { missingLetter } from './missingLetter'
import { carriageCount, pictureSentence, whatIs, whereStops, whereTo } from './sentences'
import { destination, findStationSign, pictureForWord, wordForPicture } from './words'

export const READING_GENERATORS: Generator[] = [
  startsWith,
  matchLetter,
  platformLetter,
  findStationSign,
  destination,
  wordForPicture,
  pictureForWord,
  missingLetter,
  whereStops,
  whereTo,
  carriageCount,
  whatIs,
  pictureSentence,
]
