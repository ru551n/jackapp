import type { Choice, Generator, Question } from '../../core/types'
import { wrongIds } from '../helpers'
import {
  COLORS,
  colourPic,
  type Color,
  NUMBER_WORDS,
  PICTURE_NOUNS,
  VEHICLES,
  choiceCount,
  distinct,
  picChoice,
  wordSign,
} from './vocab'

/** Hear a word → choose the picture. Hint 1 shows the word as a sign, so audio is optional. */
export const hearWord: Generator = {
  id: 'en.listen.hearWord',
  skill: 'en.listen',
  levels: [1, 5],
  generate({ rng, level, support }) {
    const count = choiceCount(level, support)
    let text: string
    let answer: string
    let sv: string
    let choices: Choice[]
    let theme: Question['theme']
    const kind = level >= 5 && rng.next() < 0.5 ? 'count' : level >= 4 ? 'colour' : 'noun'
    if (kind === 'noun') {
      const picked = distinct(rng, PICTURE_NOUNS, count)
      const t = picked[0]
      choices = rng.shuffle(picked).map((w) => picChoice(w.en, w.sv, { sprite: w.sprite }))
      ;[text, answer, sv, theme] = [t.en, t.en, t.sv, t.theme]
    } else if (kind === 'colour') {
      const cs = rng.shuffle(COLORS)
      const [n, n2] = distinct(rng, VEHICLES, 2)
      const all: [Color, typeof n][] = [
        [cs[0], n],
        [cs[1], n],
        [cs[0], n2],
      ]
      const pairs = all.slice(0, count)
      choices = rng.shuffle(pairs).map(([c, v]) => colourPic(c, v))
      ;[text, answer, sv, theme] = [`${cs[0].en} ${n.en}`, `${cs[0].tint}:${n.en}`, `${cs[0].sv} ${n.sv}`, n.theme]
    } else {
      const v = rng.pick(VEHICLES)
      const ns = rng.shuffle([1, 2, 3]).slice(0, 3)
      const k = ns[0]
      choices = [...ns]
        .sort()
        .map((x) => picChoice(String(x), `${x}`, ...Array.from({ length: x }, () => ({ sprite: v.sprite }))))
      ;[text, answer, sv, theme] = [`${NUMBER_WORDS[k]} ${v.plural}`, String(k), String(k), v.theme]
      if (k === 1) text = `one ${v.en}`
    }
    return {
      id: `en.listen.hearWord:${kind}:${answer}:${choices
        .map((c) => c.id)
        .sort()
        .join('-')}`,
      skill: 'en.listen',
      level,
      theme,
      prompt: 'Lyssna och tryck på rätt bild.',
      speech: 'Lyssna och tryck på rätt bild.',
      listen: { text, lang: 'en' },
      task: { kind: 'choice', choices, answer },
      hints: [
        { text: `Ordet är ${text}.`, scene: wordSign(text) },
        { text: kind === 'noun' ? `Hitta ${sv}.` : 'Ta bort några svar.', eliminate: wrongIds(choices, answer) },
      ],
      success: `Ja! ${text}${kind === 'noun' ? ` = ${sv}` : ''}.`,
    }
  },
}
