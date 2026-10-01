import type { Generator, Level, Scene } from '../../core/types'
import { textChoices, wrongIds } from '../helpers'
import { ALPHABET, WORDS, choiceCount } from './util'

const low = (level: Level, s: string) => (level <= 2 ? s.toUpperCase() : s.toLowerCase())

/** "Vilken bokstav börjar TÅG på?" */
export const startsWith: Generator = {
  id: 'read.letters.startsWith',
  skill: 'read.letters',
  levels: [1, 3],
  generate({ rng, level, support }) {
    const word = rng.pick(WORDS)
    const shown = low(level, word.w)
    const answer = low(level, word.w[0])
    const choices = textChoices(
      rng,
      answer,
      ALPHABET.map((l) => low(level, l)),
      choiceCount(level, support),
    )
    const text: Scene = { kind: 'text', text: shown, size: 'xl' }
    const scene: Scene = word.sprite
      ? { kind: 'group', direction: 'row', scenes: [{ kind: 'row', items: [{ sprite: word.sprite }] }, text] }
      : text
    return {
      id: `read.letters.startsWith:${word.w.toUpperCase()}:${answer.toUpperCase()}`,
      skill: 'read.letters',
      level,
      theme: 'train',
      prompt: `Vilken bokstav börjar ${shown} på?`,
      scene,
      task: { kind: 'choice', choices, answer },
      hints: [
        { text: 'Titta på den första bokstaven i ordet.' },
        { text: 'Vi tar bort en bokstav.', eliminate: wrongIds(choices, answer) },
      ],
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
      hints: [
        { text: 'Titta på formen på bokstaven.' },
        { text: 'Vi tar bort en bokstav.', eliminate: wrongIds(choices, letter) },
      ],
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
      scene: { kind: 'text', text: `PERRONG ${answer}`, size: 'xl' },
      task: { kind: 'choice', choices, answer },
      hints: [
        { text: `Leta efter bokstaven ${answer}.` },
        { text: 'Vi tar bort en skylt.', eliminate: wrongIds(choices, answer) },
      ],
      success: `Ja! Perrong ${answer}.`,
    }
  },
}
