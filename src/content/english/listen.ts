import type { Choice, Generator, Question } from '../../core/types'
import { capitalize } from '../../core/swedish'
import { wrongIds } from '../helpers'
import {
  COLORS,
  colourPic,
  type Color,
  PICTURE_NOUNS,
  VEHICLES,
  choiceCount,
  distinct,
  enCount,
  picChoice,
  svColA,
  svCount,
  svOne,
  wordSign,
} from './vocab'

/** Hear a word → choose the picture. Hint 1 shows the word as a sign, so audio is optional there. */
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
      // Plausible distractors early on: vehicles against vehicles.
      const picked = distinct(rng, level <= 2 ? VEHICLES : PICTURE_NOUNS, count, undefined, level)
      const t = picked[0]
      choices = rng.shuffle(picked).map((w) => picChoice(w.en, w.sv, { sprite: w.sprite }))
      ;[text, answer, sv, theme] = [t.en, t.en, svOne(t), t.theme]
    } else if (kind === 'colour') {
      const cs = rng.shuffle(COLORS)
      const [n, n2] = distinct(rng, VEHICLES, 2, undefined, level)
      const all: [Color, typeof n][] = [
        [cs[0], n],
        [cs[1], n],
        [cs[0], n2],
      ]
      choices = rng.shuffle(all.slice(0, count)).map(([c, v]) => colourPic(c, v))
      ;[text, answer, sv, theme] = [`${cs[0].en} ${n.en}`, `${cs[0].tint}:${n.en}`, svColA(cs[0], n), n.theme]
    } else {
      const v = rng.pick(VEHICLES)
      const ns = rng.shuffle([1, 2, 3])
      const k = ns[0]
      choices = [...ns]
        .sort()
        .map((x) => picChoice(String(x), svCount(x, v), ...Array.from({ length: x }, () => ({ sprite: v.sprite }))))
      ;[text, answer, sv, theme] = [enCount(k, v), String(k), svCount(k, v), v.theme]
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
        {
          text: `Ordet är ${text}.`,
          speech: 'Titta på ordet och lyssna en gång till.',
          scene: wordSign(text),
          listen: { text, lang: 'en' },
        },
        { text: `Hitta ${sv}.`, eliminate: wrongIds(choices, answer) },
      ],
      success: `Ja! ${capitalize(text)}.`,
    }
  },
}
