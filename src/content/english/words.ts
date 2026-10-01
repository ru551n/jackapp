import type { Generator } from '../../core/types'
import { wrongIds } from '../helpers'
import { EXTRA_WORDS, PICTURE_NOUNS, ask, choiceCount, distinct, picChoice, row, wordSign } from './vocab'

/** "Tryck på train." → picture choices. Swedish support fades with level. */
export const tapTheWord: Generator = {
  id: 'en.words.tapTheWord',
  skill: 'en.words',
  levels: [1, 5],
  generate({ rng, level, support }) {
    const picked = distinct(rng, PICTURE_NOUNS, choiceCount(level, support))
    const t = rng.pick(picked)
    const choices = picked.map((w) => picChoice(w.en, w.sv, { sprite: w.sprite }))
    return {
      id: `en.words.tapTheWord:${t.en}:${picked.map((w) => w.en).join('-')}`,
      skill: 'en.words',
      level,
      theme: t.theme,
      ...ask(level, support, { sv: `Tryck på ${t.en}.`, en: `Tap the ${t.en}.`, say: t.en }),
      scene: level <= 2 || support === 'extra' ? wordSign(t.en) : undefined,
      task: { kind: 'choice', choices, answer: t.en },
      hints: [
        { text: `${t.en} betyder ${t.sv}.`, scene: wordSign(t.en) },
        { text: `Hitta ${t.sv}.`, eliminate: wrongIds(choices, t.en) },
      ],
      success: `Ja! ${t.en} = ${t.sv}.`,
    }
  },
}

/** A picture → pick its English word. */
export const pictureToWord: Generator = {
  id: 'en.words.pictureToWord',
  skill: 'en.words',
  levels: [2, 5],
  generate({ rng, level, support }) {
    const picked = distinct(rng, PICTURE_NOUNS, choiceCount(level, support))
    const t = rng.pick(picked)
    const choices = picked.map((w) => ({ id: w.en, label: w.en }))
    return {
      id: `en.words.pictureToWord:${t.en}:${picked.map((w) => w.en).join('-')}`,
      skill: 'en.words',
      level,
      theme: t.theme,
      ...ask(level, support, {
        sv: 'Vilket ord passar bilden?',
        en: 'Which word?',
        speech: 'Vilket ord passar bilden?',
      }),
      scene: row({ sprite: t.sprite }),
      task: { kind: 'choice', choices, answer: t.en },
      hints: [
        { text: `Bilden visar ${t.svDef}.` },
        { text: `Hitta ordet för ${t.sv}.`, eliminate: wrongIds(choices, t.en) },
      ],
      success: `Ja! ${t.en} = ${t.sv}.`,
    }
  },
}

/** English word (vehicles, airport words, greetings) → Swedish word. */
export const meaning: Generator = {
  id: 'en.words.meaning',
  skill: 'en.words',
  levels: [3, 5],
  generate({ rng, level, support }) {
    const all = [
      ...PICTURE_NOUNS.map((n) => ({
        en: n.en,
        sv: n.sv,
        clue: `Det finns på bilden.`,
        scene: row({ sprite: n.sprite }),
      })),
      ...EXTRA_WORDS,
    ]
    const picked = rng.shuffle(all).slice(0, choiceCount(level, support))
    const t = picked[0]
    const choices = rng.shuffle(picked).map((w) => ({ id: w.en, label: w.sv }))
    return {
      id: `en.words.meaning:${t.en}:${picked
        .map((w) => w.en)
        .sort()
        .join('-')}`,
      skill: 'en.words',
      level,
      theme: 'airport',
      ...ask(level, support, {
        sv: `Vad betyder ${t.en}?`,
        en: `What is ${t.en}?`,
        say: t.en,
        speech: 'Vad betyder ordet?',
      }),
      scene: wordSign(t.en),
      task: { kind: 'choice', choices, answer: t.en },
      hints: [
        { text: t.clue, scene: t.scene },
        { text: 'Ta bort några svar.', eliminate: wrongIds(choices, t.en) },
      ],
      success: `Ja! ${t.en} = ${t.sv}.`,
    }
  },
}

/** Traffic signal: stop (red) and go (green). */
export const signals: Generator = {
  id: 'en.words.signals',
  skill: 'en.words',
  levels: [1, 4],
  generate({ rng, level, support }) {
    const stop = rng.next() < 0.5
    const ans = stop ? 'stop' : 'go'
    const sv = stop ? 'stanna' : 'kör'
    const choices = ['stop', 'go'].map((w) => ({ id: w, label: w }))
    const sw = level <= 2 || support === 'extra'
    return {
      id: `en.words.signals:${ans}`,
      skill: 'en.words',
      level,
      theme: 'train',
      prompt: sw ? 'Vilket ord passar signalen?' : stop ? 'The signal is red.' : 'The signal is green.',
      speech: 'Vilket ord passar signalen?',
      listen: { text: sw ? ans : stop ? 'The signal is red.' : 'The signal is green.', lang: 'en' },
      scene: row({ sprite: 'signal', tint: stop ? 'red' : 'green' }),
      task: { kind: 'choice', choices, answer: ans },
      hints: [{ text: stop ? 'Röd signal betyder stanna.' : 'Grön signal betyder kör.', scene: wordSign(ans) }],
      success: `Ja! ${ans} = ${sv}.`,
    }
  },
}
