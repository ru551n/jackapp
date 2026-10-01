import type { Choice, Generator } from '../../core/types'
import { textChoices, wrongIds } from '../helpers'
import { CITIES, METRO_STATIONS, SPRITE_NAMES, WORDS, cased, choiceCount } from './util'

const PICTURE_WORDS = WORDS.filter((w) => w.sprite)

const signChoices = (cs: Choice[]): Choice[] =>
  cs.map((c) => ({ id: c.id, visual: { kind: 'sign', text: c.id, style: 'station' }, ariaLabel: c.id }))

/** "Tryck på skylten där det står SLUSSEN." */
export const findStationSign: Generator = {
  id: 'read.words.stationSign',
  skill: 'read.words',
  levels: [1, 5],
  generate({ rng, level, support }) {
    const name = rng.pick(METRO_STATIONS)
    const answer = cased(level, name)
    const choices = signChoices(
      textChoices(
        rng,
        answer,
        METRO_STATIONS.map((s) => cased(level, s)),
        choiceCount(level, support),
      ),
    )
    return {
      id: `read.words.stationSign:${name}:${choices.length}`,
      skill: 'read.words',
      level,
      theme: 'metro',
      prompt: `Tryck på skylten där det står ${answer}.`,
      scene: { kind: 'text', text: answer, size: 'lg' },
      task: { kind: 'choice', choices, answer },
      hints: [
        { text: `${answer} börjar på ${answer[0]}.` },
        { text: 'Titta på första bokstaven.', eliminate: wrongIds(choices, answer) },
      ],
      success: `Ja, det står ${answer}.`,
    }
  },
}

/** Departure board: "Tåget till GÖTEBORG" — find the right sign. */
export const destination: Generator = {
  id: 'read.words.destination',
  skill: 'read.words',
  levels: [2, 5],
  generate({ rng, level, support }) {
    const name = rng.pick(CITIES)
    const answer = cased(level, name)
    const choices = signChoices(
      textChoices(
        rng,
        answer,
        CITIES.map((s) => cased(level, s)),
        choiceCount(level, support),
      ),
    ).map((c) => ({ ...c, visual: { kind: 'sign' as const, text: c.id, style: 'departure' as const } }))
    return {
      id: `read.words.destination:${name}`,
      skill: 'read.words',
      level,
      theme: 'train',
      prompt: `Tåget ska till ${answer}. Vilken skylt visar det?`,
      scene: { kind: 'row', items: [{ sprite: 'locomotive' }], label: `Tåget till ${answer}` },
      task: { kind: 'choice', choices, answer },
      hints: [
        { text: `Leta efter ${answer[0]} först.` },
        { text: 'Vi tar bort en skylt.', eliminate: wrongIds(choices, answer) },
      ],
      success: `Ja! Tåget åker till ${answer}.`,
    }
  },
}

/** Picture → word: "Vilket ord passar bilden?" */
export const wordForPicture: Generator = {
  id: 'read.words.wordForPicture',
  skill: 'read.words',
  levels: [1, 4],
  generate({ rng, level, support }) {
    const word = rng.pick(PICTURE_WORDS)
    const answer = cased(level, word.w)
    const choices = textChoices(
      rng,
      answer,
      PICTURE_WORDS.map((w) => cased(level, w.w)),
      choiceCount(level, support),
    )
    return {
      id: `read.words.wordForPicture:${word.w.toUpperCase()}`,
      skill: 'read.words',
      level,
      theme: 'train',
      prompt: 'Vilket ord passar bilden?',
      scene: { kind: 'row', items: [{ sprite: word.sprite! }] },
      task: { kind: 'choice', choices, answer },
      hints: [
        { text: 'Säg vad bilden visar. Vilket ord börjar på samma ljud?' },
        { text: 'Vi tar bort ett ord.', eliminate: wrongIds(choices, answer) },
      ],
      success: `Ja! Det står ${answer}.`,
    }
  },
}

/** Word → picture: "Vilken bild passar ordet TÅG?" */
export const pictureForWord: Generator = {
  id: 'read.words.pictureForWord',
  skill: 'read.words',
  levels: [1, 4],
  generate({ rng, level, support }) {
    const word = rng.pick(PICTURE_WORDS)
    const shown = cased(level, word.w)
    const n = Math.min(choiceCount(level, support), 3)
    const sprites = rng.shuffle(PICTURE_WORDS.filter((w) => w !== word)).slice(0, n - 1)
    const choices: Choice[] = rng.shuffle([word, ...sprites]).map((w) => ({
      id: w.w,
      visual: { kind: 'row', items: [{ sprite: w.sprite! }] },
      ariaLabel: SPRITE_NAMES[w.sprite!],
    }))
    return {
      id: `read.words.pictureForWord:${word.w.toUpperCase()}`,
      skill: 'read.words',
      level,
      theme: 'train',
      prompt: `Vilken bild passar ordet ${shown}?`,
      scene: { kind: 'text', text: shown, size: 'xl' },
      task: { kind: 'choice', choices, answer: word.w },
      hints: [
        { text: `Ordet börjar på ${shown[0]}. Läs långsamt.` },
        { text: 'Vi tar bort en bild.', eliminate: wrongIds(choices, word.w) },
      ],
      success: `Ja! ${shown} är rätt bild.`,
    }
  },
}
