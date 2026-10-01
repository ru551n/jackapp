import type { Generator, Scene, SpriteId } from '../../core/types'
import { choiceCount, textChoices } from '../helpers'
import { cased, withElim } from './util'

const VOWELS = [...'AEIOUYÅÄÖ']
const CONSONANTS = [...'BDFGHKLMNPRSTV']

interface Entry {
  w: string
  sprite?: SpriteId
}
// Length decides the level: ≤3 letters at 1, ≤4 at 2, ≤6 at 3, ≤9 at 4, any at 5.
const WORDS: Entry[] = [
  { w: 'tåg', sprite: 'locomotive' },
  { w: 'bil', sprite: 'car' },
  { w: 'buss', sprite: 'bus' },
  { w: 'vagn', sprite: 'carriage' },
  { w: 'spår' },
  { w: 'kista' },
  { w: 'lok', sprite: 'locomotive' },
  { w: 'resa' },
  { w: 'perrong' },
  { w: 'biljett' },
  { w: 'station', sprite: 'station' },
  { w: 'signal', sprite: 'signal' },
  { w: 'flygplan', sprite: 'airliner' },
  { w: 'slussen' },
  { w: 'odenplan' },
]
const MAX_LEN = { 1: 4, 2: 4, 3: 6, 4: 9, 5: 12 } as const

/** `T _ G` with choices Å/A/O. Level 1: picture shown, first letter missing, 2 choices. */
export const missingLetter: Generator = {
  id: 'read.missingLetter.word',
  skill: 'read.missingLetter',
  levels: [1, 5],
  generate({ rng, level, support }) {
    let pool = WORDS.filter((e) => e.w.length <= MAX_LEN[level] && (level > 1 || e.sprite))
    // Extra support: only picture-backed words, so a picture is always shown.
    if (support === 'extra' && pool.some((e) => e.sprite)) pool = pool.filter((e) => e.sprite)
    const { w: word, sprite } = rng.pick(pool)
    const shown = cased(level, word)
    const idx = level === 1 ? 0 : rng.int(0, shown.length - 1)
    const answer = shown[idx]
    const letters = VOWELS.includes(answer.toUpperCase()) ? VOWELS : CONSONANTS
    // Distractors share the answer's case (never give it away) and are not in the word.
    const same = (l: string) => (level <= 2 ? l.toUpperCase() : l.toLowerCase())
    const choices = textChoices(
      rng,
      answer,
      letters.filter((l) => !word.toUpperCase().includes(l)).map(same),
      Math.min(choiceCount(level, support), 3),
    )
    const gapped = [...shown].map((ch, i) => (i === idx ? '_' : ch)).join(' ')
    const text: Scene = { kind: 'text', text: gapped, size: 'xl' }
    const pic: Scene[] = sprite ? [{ kind: 'row', items: [{ sprite }] }] : []
    const scene: Scene = pic.length ? { kind: 'group', direction: 'column', scenes: [...pic, text] } : text
    return {
      id: `read.missingLetter.word:${word.toUpperCase()}:${answer.toUpperCase()}@${idx}`,
      skill: 'read.missingLetter',
      level,
      theme: 'train',
      prompt: 'Vilken bokstav saknas?',
      scene,
      task: { kind: 'choice', choices, answer },
      hints: withElim(
        pic.length
          ? { text: 'Titta på bilden och säg ordet långsamt. Vilket ljud saknas?', scene }
          : { text: 'Lyssna på ordet och säg det långsamt.', speech: `Ordet är ${word}. Vilken bokstav saknas?` },
        choices,
        answer,
        'Vi tar bort en bokstav.',
      ),
      success: `Ja! Det står ${shown}.`,
    }
  },
}
