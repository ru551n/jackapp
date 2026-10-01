import type { Choice, Generator } from '../../core/types'
import { choiceCount, textChoices } from '../helpers'
import { CITIES, CITIES_EXTRA, METRO_STATIONS, SPRITE_NAMES, WORDS, cased, withElim } from './util'

const PICTURE_WORDS = WORDS.filter((w) => w.sprite)
// Extra support: shorter words.
const forSupport = (support: string) =>
  support === 'extra' ? PICTURE_WORDS.filter((w) => w.w.length <= 5) : PICTURE_WORDS

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
      scene:
        support === 'extra'
          ? {
              kind: 'row',
              items: [{ sprite: 'station' }],
              label: `${answer}. Det börjar på ${answer[0]}.`,
            }
          : { kind: 'text', text: answer, size: 'lg' },
      task: { kind: 'choice', choices, answer },
      hints: withElim(
        {
          text: `${answer} börjar på ${answer[0]}. Läs långsamt.`,
          scene: { kind: 'sign', text: answer, style: 'station' },
        },
        choices,
        answer,
        'Titta på första bokstaven.',
      ),
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
    const count = choiceCount(level, support)
    // Levels 4-5: look-alikes with the same first letter, so the first letter alone does not solve it.
    const all = [...CITIES, ...CITIES_EXTRA].filter((c) => c !== name)
    const look = level >= 4 ? all.filter((c) => c[0] === name[0]) : []
    const others = all.filter((c) => !look.includes(c))
    const distractors = [...rng.shuffle(look), ...rng.shuffle(level >= 4 ? others : CITIES.filter((c) => c !== name))]
    const choices = signChoices(
      textChoices(
        rng,
        answer,
        distractors.slice(0, count - 1).map((s) => cased(level, s)),
        count,
      ),
    ).map((c) => ({ ...c, visual: { kind: 'sign' as const, text: c.id, style: 'departure' as const } }))
    return {
      id: `read.words.destination:${name}`,
      skill: 'read.words',
      level,
      theme: 'train',
      prompt: `Tåget ska till ${answer}. Vilken skylt visar det?`,
      scene: {
        kind: 'row',
        items: [{ sprite: 'locomotive' }],
        label: support === 'extra' ? `Tåget till ${answer}. Det börjar på ${answer[0]}.` : `Tåget till ${answer}`,
      },
      task: { kind: 'choice', choices, answer },
      hints: withElim(
        {
          text:
            level >= 4
              ? `Det börjar på ${answer[0]} och slutar på ${answer.slice(-2)}. Läs hela ordet.`
              : `Leta efter ${answer[0]} först.`,
          scene: { kind: 'sign', text: answer, style: 'departure' },
        },
        choices,
        answer,
        'Vi tar bort en skylt.',
      ),
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
    const word = rng.pick(forSupport(support))
    const answer = cased(level, word.w)
    const choices = textChoices(
      rng,
      answer,
      forSupport(support).map((w) => cased(level, w.w)),
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
      hints: withElim(
        { text: `Säg vad bilden visar, långsamt. Ordet börjar på ${answer[0]}.` },
        choices,
        answer,
        'Vi tar bort ett ord.',
      ),
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
    const word = rng.pick(forSupport(support))
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
      hints: withElim({ text: `Ordet börjar på ${shown[0]}. Läs långsamt.` }, choices, word.w, 'Vi tar bort en bild.'),
      success: `Ja! ${shown} är rätt bild.`,
    }
  },
}
