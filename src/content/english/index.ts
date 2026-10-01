import type { Generator } from '../../core/types'
import { bigSmall, fastSlow } from './adjectives'
import { tapColor } from './colors'
import { hearWord } from './listen'
import { howMany, wordToNumeral } from './numbers'
import { readSentence } from './sentences'
import { meaning, pictureToWord, signals, tapTheWord } from './words'

export const ENGLISH_GENERATORS: Generator[] = [
  tapTheWord,
  pictureToWord,
  meaning,
  signals,
  tapColor,
  howMany,
  wordToNumeral,
  bigSmall,
  fastSlow,
  hearWord,
  readSentence,
]
