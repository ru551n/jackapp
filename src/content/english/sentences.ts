import type { Choice, Generator, Question } from '../../core/types'
import { capitalize } from '../../core/swedish'
import { wrongIds } from '../helpers'
import {
  COLORS,
  colourPic,
  type Color,
  VEHICLES,
  distinct,
  enCount,
  picChoice,
  sizeChoice,
  svCol,
  svCount,
  svOne,
  wordSign,
} from './vocab'

type Built = { text: string; sv: string; choices: Choice[]; answer: string; theme: Question['theme'] }

/** Colour: L1-2 "a red train", L3+ "The train is red." */
function colour(rng: Parameters<Generator['generate']>[0]['rng'], level: number): Built {
  const [c, c2, c3] = rng.shuffle(COLORS)
  const [v, v2] = distinct(rng, VEHICLES, 2, undefined, level)
  const pairs: [Color, typeof v][] =
    level >= 4
      ? [
          [c, v],
          [c2, v],
          [c, v2],
        ]
      : level >= 3
        ? [
            [c, v],
            [c2, v],
            [c3, v],
          ]
        : [
            [c, v],
            [c2, v],
          ]
  return {
    text: level <= 2 ? `a ${c.en} ${v.en}` : `The ${v.en} is ${c.en}.`,
    sv:
      level <= 2
        ? `${v.neuter ? 'ett' : 'en'} ${svCol(c, v)}`
        : `${v.svDef[0].toUpperCase()}${v.svDef.slice(1)} är ${v.neuter ? c.svT : c.sv}.`,
    choices: rng.shuffle(pairs).map(([x, y]) => colourPic(x, y)),
    answer: `${c.tint}:${v.en}`,
    theme: v.theme,
  }
}

function size(rng: Parameters<Generator['generate']>[0]['rng']): Built {
  const big = rng.next() < 0.5
  return {
    text: `The plane is ${big ? 'big' : 'small'}.`,
    sv: `Flygplanet är ${big ? 'stort' : 'litet'}.`,
    choices: rng.shuffle([1, 0.4]).map((s) => sizeChoice(s, s === 1 ? 'stort flygplan' : 'litet flygplan')),
    answer: big ? '1' : '0.4',
    theme: 'airport',
  }
}

function stops(rng: Parameters<Generator['generate']>[0]['rng']): Built {
  const stop = rng.next() < 0.5
  const t = rng.pick(VEHICLES.filter((v) => ['train', 'tram', 'bus'].includes(v.en)))
  return {
    text: `The ${t.en} ${stop ? 'stops' : 'goes'} here.`,
    sv: `${t.svDef[0].toUpperCase()}${t.svDef.slice(1)} ${stop ? 'stannar' : 'åker'} här.`,
    choices: [
      picChoice('stop', 'röd signal', { sprite: 'signal', tint: 'red' }),
      picChoice('go', 'grön signal', { sprite: 'signal', tint: 'green' }),
    ],
    answer: stop ? 'stop' : 'go',
    theme: t.theme,
  }
}

function see(rng: Parameters<Generator['generate']>[0]['rng']): Built {
  const v = rng.pick(VEHICLES)
  const [, v2] = distinct(rng, VEHICLES, 2, v, 5)
  const n = rng.int(1, 3)
  if (rng.next() < 0.5) {
    return {
      text: `I see a ${v.en}.`,
      sv: `Jag ser ${svOne(v)}.`,
      choices: rng.shuffle([v, v2]).map((x) => picChoice(x.en, x.sv, { sprite: x.sprite })),
      answer: v.en,
      theme: v.theme,
    }
  }
  return {
    text: `I see ${enCount(n, v)}.`,
    sv: `Jag ser ${svCount(n, v)}.`,
    choices: [1, 2, 3].map((x) =>
      picChoice(String(x), svCount(x, v), ...Array.from({ length: x }, () => ({ sprite: v.sprite }))),
    ),
    answer: String(n),
    theme: v.theme,
  }
}

/** Very short sentence → matching picture. */
export const readSentence: Generator = {
  id: 'en.sentences.readSentence',
  skill: 'en.sentences',
  levels: [1, 5],
  generate({ rng, level, support }) {
    const kinds =
      level <= 3 ? ['colour'] : level === 4 ? ['colour', 'size', 'stops'] : ['colour', 'size', 'stops', 'see', 'see']
    const kind = rng.pick(kinds)
    const b = { colour: () => colour(rng, level), size: () => size(rng), stops: () => stops(rng), see: () => see(rng) }[
      kind as 'colour'
    ]()
    const sw = level <= 2 || support === 'extra'
    const speech = level <= 2 ? 'Vilken bild passar?' : 'Tryck på rätt bild.'
    return {
      id: `en.sentences.readSentence:${b.text}:${b.choices
        .map((c) => c.id)
        .sort()
        .join('-')}`,
      skill: 'en.sentences',
      level,
      theme: b.theme,
      ...(sw ? { prompt: speech } : { prompt: 'Tap the picture.', promptLang: 'en' as const }),
      speech,
      listen: { text: b.text, lang: 'en' },
      scene: { kind: 'text', text: b.text, size: 'xl', lang: 'en' },
      task: { kind: 'choice', choices: b.choices, answer: b.answer },
      hints: [
        { text: 'Lyssna en gång till.', listen: { text: b.text, lang: 'en' } },
        { text: `Det betyder: ${b.sv}`, scene: wordSign(b.text) },
        { text: 'Ta bort några svar.', eliminate: wrongIds(b.choices, b.answer) },
      ],
      success: `Ja! ${capitalize(b.text)}`,
    }
  },
}
