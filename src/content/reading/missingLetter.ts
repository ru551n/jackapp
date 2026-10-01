import type { Generator } from '../../core/types'
import { textChoices, wrongIds } from '../helpers'
import { cased, choiceCount } from './util'

const VOWELS = [...'AEIOUYÅÄÖ']
const CONSONANTS = [...'BDFGHKLMNPRSTV']

// [word, sprite?] — length decides the level: ≤4 letters at 2, ≤6 at 3, any at 4–5.
const WORDS = [
  'tåg',
  'buss',
  'spår',
  'vagn',
  'kista',
  'lok',
  'resa',
  'perrong',
  'biljett',
  'station',
  'signal',
  'flygplan',
  'slussen',
  'odenplan',
]
const MAX_LEN = { 1: 3, 2: 4, 3: 6, 4: 9, 5: 12 } as const

/** `T _ G` with choices Å/A/O. */
export const missingLetter: Generator = {
  id: 'read.missingLetter.word',
  skill: 'read.missingLetter',
  levels: [2, 5],
  generate({ rng, level, support }) {
    const word = rng.pick(WORDS.filter((w) => w.length <= MAX_LEN[level]))
    const shown = cased(level, word)
    const idx = rng.int(0, shown.length - 1)
    const answer = shown[idx]
    const pool = VOWELS.includes(answer.toUpperCase()) ? VOWELS : CONSONANTS
    const choices = textChoices(
      rng,
      answer,
      pool.map((l) => cased(level, l)),
      Math.min(choiceCount(level, support), 3),
    )
    const gapped = [...shown].map((ch, i) => (i === idx ? '_' : ch)).join(' ')
    return {
      id: `read.missingLetter.word:${word.toUpperCase()}:${answer.toUpperCase()}@${idx}`,
      skill: 'read.missingLetter',
      level,
      theme: 'train',
      prompt: 'Vilken bokstav saknas?',
      scene: { kind: 'text', text: gapped, size: 'xl' },
      task: { kind: 'choice', choices, answer },
      hints: [
        { text: 'Läs ordet högt. Vilken bokstav låter rätt?' },
        { text: 'Vi tar bort en bokstav.', eliminate: wrongIds(choices, answer) },
      ],
      success: `Ja! Det står ${shown}.`,
    }
  },
}
