import type { Generator, Level, Scene } from '../../core/types'
import { choiceCount, textChoices } from '../helpers'
import { ALPHABET, WORDS, withElim } from './util'

const low = (level: Level, s: string) => (level <= 2 ? s.toUpperCase() : s.toLowerCase())

// Levels 1-2 use only these short picture-backed words.
const SHORT = ['tåg', 'bil', 'buss', 'vagn']

/** "Vilken bokstav börjar TÅG på?" */
export const startsWith: Generator = {
  id: 'read.letters.startsWith',
  skill: 'read.letters',
  levels: [1, 3],
  generate({ rng, level, support }) {
    // Extra support: always a picture-backed word.
    const pool = WORDS.filter((w) => (level <= 2 ? SHORT.includes(w.w) : support === 'extra' ? w.sprite : true))
    const word = rng.pick(pool)
    const shown = low(level, word.w)
    const answer = low(level, word.w[0])
    // Distractors are letters that do not occur in the word.
    const choices = textChoices(
      rng,
      answer,
      ALPHABET.filter((l) => !word.w.toUpperCase().includes(l)).map((l) => low(level, l)),
      choiceCount(level, support),
    )
    const text: Scene = { kind: 'text', text: shown, size: 'xl' }
    const pic: Scene[] = word.sprite ? [{ kind: 'row', items: [{ sprite: word.sprite }] }] : []
    const scene: Scene = pic.length ? { kind: 'group', direction: 'row', scenes: [...pic, text] } : text
    return {
      id: `read.letters.startsWith:${word.w.toUpperCase()}:${answer.toUpperCase()}`,
      skill: 'read.letters',
      level,
      theme: 'train',
      prompt: `Vilken bokstav börjar ${shown} på?`,
      scene,
      task: { kind: 'choice', choices, answer },
      hints: withElim(
        {
          text: `Säg ordet långsamt. Första ljudet kommer från första bokstaven, längst till vänster.`,
          scene: { kind: 'group', direction: 'row', scenes: [...pic, { kind: 'sign', text: shown, style: 'word' }] },
        },
        choices,
        answer,
        'Vi tar bort en bokstav.',
      ),
      success: `Ja! ${shown} börjar på ${answer}.`,
    }
  },
}

/** Find the same letter (level 3: the capital that goes with a small letter). */
export const matchLetter: Generator = {
  id: 'read.letters.match',
  skill: 'read.letters',
  levels: [1, 3],
  generate({ rng, level, support }) {
    const letter = rng.pick(ALPHABET)
    const shown = level === 3 ? letter.toLowerCase() : letter
    const choices = textChoices(rng, letter, ALPHABET, choiceCount(level, support))
    return {
      id: `read.letters.match:${shown}:${letter}`,
      skill: 'read.letters',
      level,
      theme: 'metro',
      prompt: level === 3 ? `Vilken stor bokstav hör ihop med ${shown}?` : 'Hitta samma bokstav.',
      scene: { kind: 'text', text: shown, size: 'xl' },
      task: { kind: 'choice', choices, answer: letter },
      hints: withElim(
        {
          text: `Titta på formen. Bokstaven heter ${letter}.`,
          scene: {
            kind: 'group',
            direction: 'row',
            scenes: [{ kind: 'text', text: `${shown}  =  ${letter}`, size: 'xl' }],
          },
        },
        choices,
        letter,
        'Vi tar bort en bokstav.',
      ),
      success: `Ja! Det är ${letter}.`,
    }
  },
}

/** "Tåget går från perrong C." — tap the platform sign with the right letter. */
export const platformLetter: Generator = {
  id: 'read.letters.platform',
  skill: 'read.letters',
  levels: [1, 3],
  generate({ rng, level, support }) {
    const answer = rng.pick([...'ABCDEF'])
    const choices = textChoices(rng, answer, [...'ABCDEF'], choiceCount(level, support)).map((c) => ({
      id: c.id,
      visual: { kind: 'sign' as const, text: c.id, style: 'platform' as const },
      ariaLabel: `Perrong ${c.id}`,
    }))
    return {
      id: `read.letters.platform:${answer}`,
      skill: 'read.letters',
      level,
      theme: 'train',
      prompt: `Tåget går från perrong ${answer}. Vilken skylt?`,
      speech: `Tåget går från perrong ${answer}. Vilken skylt ska du trycka på?`,
      scene:
        support === 'extra'
          ? {
              kind: 'group',
              direction: 'row',
              scenes: [
                { kind: 'text', text: `PERRONG ${answer}`, size: 'xl' },
                { kind: 'sign', text: answer, style: 'platform' },
              ],
            }
          : { kind: 'text', text: `PERRONG ${answer}`, size: 'xl' },
      task: { kind: 'choice', choices, answer },
      hints: withElim(
        { text: `Leta efter bokstaven ${answer}.`, scene: { kind: 'sign', text: answer, style: 'platform' } },
        choices,
        answer,
        'Vi tar bort en skylt.',
      ),
      success: `Ja! Perrong ${answer}.`,
    }
  },
}
