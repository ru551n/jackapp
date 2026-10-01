import type { Generator } from '../../core/types'
import { capitalize } from '../../core/swedish'
import { wrongIds } from '../helpers'
import {
  EXTRA_WORDS,
  PICTURE_NOUNS,
  ask,
  choiceCount,
  distinct,
  gloss,
  picChoice,
  row,
  showSign,
  swedishLevel,
  wordSign,
} from './vocab'

/** "Tryck på train." (L1–2) → "Tap the train." (L3+) → picture choices. */
export const tapTheWord: Generator = {
  id: 'en.words.tapTheWord',
  skill: 'en.words',
  levels: [1, 5],
  generate({ rng, level, support }) {
    const picked = distinct(rng, PICTURE_NOUNS, choiceCount(level, support), undefined, level)
    const t = rng.pick(picked)
    const choices = picked.map((w) => picChoice(w.en, w.sv, { sprite: w.sprite }))
    return {
      id: `en.words.tapTheWord:${t.en}:${picked.map((w) => w.en).join('-')}`,
      skill: 'en.words',
      level,
      theme: t.theme,
      ...ask(level, support, { sv: `Tryck på ${t.en}.`, en: `Tap the ${t.en}.`, say: t.en }),
      scene: showSign(level, support) ? wordSign(t.en) : undefined,
      task: { kind: 'choice', choices, answer: t.en },
      hints: [gloss(t.en, t.sv, wordSign(t.en)), { text: `Hitta ${t.svDef}.`, eliminate: wrongIds(choices, t.en) }],
      success: `Ja! ${capitalize(t.en)}.`,
    }
  },
}

/** A picture → pick its English word. */
export const pictureToWord: Generator = {
  id: 'en.words.pictureToWord',
  skill: 'en.words',
  levels: [2, 5],
  generate({ rng, level, support }) {
    const picked = distinct(rng, PICTURE_NOUNS, choiceCount(level, support), undefined, level)
    const t = rng.pick(picked)
    const choices = picked.map((w) => ({ id: w.en, label: w.en, lang: 'en' as const }))
    return {
      id: `en.words.pictureToWord:${t.en}:${picked.map((w) => w.en).join('-')}`,
      skill: 'en.words',
      level,
      theme: t.theme,
      ...ask(level, support, {
        sv: 'Vilket ord passar bilden?',
        en: 'What is this?',
        speech: 'Vilket ord passar bilden?',
      }),
      scene: row({ sprite: t.sprite }),
      task: { kind: 'choice', choices, answer: t.en },
      hints: [
        { text: `Bilden visar ${t.svDef}.` },
        {
          text: `Hitta ordet för ${t.sv}.`,
          eliminate: wrongIds(choices, t.en),
          listen: { text: t.en, lang: 'en' },
        },
      ],
      success: `Ja! ${capitalize(t.en)}.`,
    }
  },
}

/** Words without a clean picture; distractors come from the same category. */
const AIRPORT = ['airport', 'gate', 'pilot', 'wing', 'plane', 'passenger', 'suitcase']
const SAYING = ['hello', 'goodbye', 'stop', 'go']
const TARGETS = ['gate', 'wing', 'pilot', 'airport', 'hello', 'goodbye']

/** L4–5: what does an abstract English word mean? (Swedish prompt at L4.) */
export const meaning: Generator = {
  id: 'en.words.meaning',
  skill: 'en.words',
  levels: [4, 5],
  generate({ rng, level, support }) {
    const all = [...PICTURE_NOUNS.map((n) => ({ en: n.en, sv: n.sv, clue: '', scene: undefined })), ...EXTRA_WORDS]
    const byEn = (en: string) => all.find((w) => w.en === en)!
    const t = byEn(rng.pick(TARGETS))
    const group = (AIRPORT.includes(t.en) ? AIRPORT : SAYING).filter((e) => e !== t.en)
    const picked = [
      t,
      ...rng
        .shuffle(group)
        .slice(0, choiceCount(level, support) - 1)
        .map(byEn),
    ]
    const choices = rng.shuffle(picked).map((w) => ({ id: w.en, label: w.sv }))
    return {
      id: `en.words.meaning:${t.en}:${picked
        .map((w) => w.en)
        .sort()
        .join('-')}`,
      skill: 'en.words',
      level,
      theme: 'airport',
      ...ask(
        level,
        support,
        {
          sv: `Vad betyder "${t.en}"?`,
          en: `What does "${t.en}" mean?`,
          say: t.en,
          speech: 'Vad betyder ordet?',
        },
        4,
      ),
      scene: swedishLevel(level, support, 4) ? wordSign(t.en) : undefined,
      task: { kind: 'choice', choices, answer: t.en },
      hints: [
        { text: t.clue, scene: t.scene, listen: { text: t.en, lang: 'en' } },
        { text: 'Ta bort några svar.', eliminate: wrongIds(choices, t.en) },
        gloss(t.en, t.sv),
      ],
      success: `Ja! ${capitalize(t.en)}.`,
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
    const choices = ['stop', 'go'].map((w) => ({ id: w, label: w, lang: 'en' as const }))
    return {
      id: `en.words.signals:${ans}`,
      skill: 'en.words',
      level,
      theme: 'train',
      ...ask(level, support, {
        sv: 'Vilket ord passar signalen?',
        en: stop ? 'The signal is red.' : 'The signal is green.',
        say: ans,
        speech: 'Vilket ord passar signalen?',
      }),
      scene: row({ sprite: 'signal', tint: stop ? 'red' : 'green' }),
      task: { kind: 'choice', choices, answer: ans },
      hints: [
        {
          text: stop ? 'Röd signal betyder stanna.' : 'Grön signal betyder kör.',
          scene: wordSign(ans),
          listen: { text: ans, lang: 'en' },
        },
      ],
      success: `Ja! ${capitalize(ans)}.`,
    }
  },
}
