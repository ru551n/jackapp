import type { Choice, Generator, Scene, SpriteId } from '../../core/types'
import { numberWord } from '../../core/swedish'
import { choiceCount, textChoices } from '../helpers'
import { CITIES, SPRITE_NAMES, withElim } from './util'

const sentenceScene = (text: string, sprite?: SpriteId): Scene =>
  sprite
    ? {
        kind: 'group',
        direction: 'column',
        scenes: [
          { kind: 'text', text, size: 'lg' },
          { kind: 'row', items: [{ sprite }] },
        ],
      }
    : { kind: 'text', text, size: 'lg' }

const VEHICLES: { noun: string; pron: string; def: string; sprite: SpriteId; places: string[] }[] = [
  {
    noun: 'Pendeltåget',
    pron: 'det',
    def: 'pendeltåget',
    sprite: 'carriage', // a pendeltåg has no loco
    places: ['Centralen', 'Uppsala', 'Södertälje', 'Kungsängen'],
  },
  {
    noun: 'Tunnelbanan',
    pron: 'den',
    def: 'tunnelbanan',
    sprite: 'metroCar',
    places: ['Slussen', 'Odenplan', 'Hötorget', 'Kista', 'Gullmarsplan'],
  },
  { noun: 'Spårvagnen', pron: 'den', def: 'spårvagnen', sprite: 'tram', places: ['Djurgården', 'Norrmalmstorg'] },
]

/** "Pendeltåget stannar vid Centralen." → "Var stannar pendeltåget?" */
export const whereStops: Generator = {
  id: 'read.sentences.whereStops',
  skill: 'read.sentences',
  levels: [3, 5],
  generate({ rng, level, support }) {
    const v = rng.pick(VEHICLES)
    const place = rng.pick(v.places)
    // Extra support: one short sentence only.
    const second = level >= 4 && support !== 'extra' ? rng.pick(v.places.filter((p) => p !== place)) : undefined
    const asked = second && level === 5 ? second : place
    const text = second
      ? `${v.noun} stannar vid ${place}. Sedan åker ${v.pron} till ${second}.`
      : `${v.noun} stannar vid ${place}.`
    const q = asked === second ? `Vart åker ${v.def} sedan?` : `Var stannar ${v.def}?`
    // Sentence generators keep 3 options (2 with extra support): reading the text is the load, not choosing.
    const choices = textChoices(rng, asked, v.places, support === 'extra' ? 2 : 3)
    return {
      id: `read.sentences.whereStops:${v.noun}:${place}${second ? '>' + second : ''}:${asked}`,
      skill: 'read.sentences',
      level,
      theme: 'train',
      prompt: q,
      speech: `${text} ${q}`,
      scene: sentenceScene(text, v.sprite),
      task: { kind: 'choice', choices, answer: asked },
      hints: withElim(
        { text: 'Lyssna på meningen en gång till.', speech: text },
        choices,
        asked,
        'Vi tar bort ett svar.',
      ),
      success: `Ja! ${asked}.`,
    }
  },
}

/** "Tåget åker från Stockholm. Det åker till Göteborg." → "Vart åker tåget?" */
export const whereTo: Generator = {
  id: 'read.sentences.whereTo',
  skill: 'read.sentences',
  levels: [4, 5],
  generate({ rng, level, support }) {
    const to = rng.pick(CITIES.filter((c) => c !== 'Stockholm'))
    // Extra support: one short sentence only.
    const text = support === 'extra' ? `Tåget åker till ${to}.` : `Tåget åker från Stockholm. Det åker till ${to}.`
    const q = 'Vart åker tåget?'
    const choices = textChoices(
      rng,
      to,
      CITIES.filter((c) => c !== 'Stockholm'),
      support === 'extra' ? 2 : 3,
    )
    return {
      id: `read.sentences.whereTo:${to}`,
      skill: 'read.sentences',
      level,
      theme: 'train',
      prompt: q,
      speech: `${text} ${q}`,
      scene: sentenceScene(text, 'locomotive'),
      task: { kind: 'choice', choices, answer: to },
      hints: withElim(
        { text: 'Leta efter ordet till. Staden efter det är svaret.', speech: text },
        choices,
        to,
        'Vi tar bort ett svar.',
      ),
      success: `Ja! Tåget åker till ${to}.`,
    }
  },
}

/** "Tåget har tre vagnar." → pick the matching picture. */
export const carriageCount: Generator = {
  id: 'read.sentences.carriages',
  skill: 'read.sentences',
  levels: [3, 5],
  generate({ rng, level, support }) {
    const n = rng.int(2, 5)
    const text = `Tåget har ${numberWord(n)} vagnar.`
    const counts = rng.shuffle([2, 3, 4, 5].filter((k) => k !== n)).slice(0, support === 'extra' ? 1 : 2)
    const choices: Choice[] = rng.shuffle([n, ...counts]).map((k) => ({
      id: String(k),
      visual: {
        kind: 'row',
        items: [{ sprite: 'locomotive' }, ...Array.from({ length: k }, () => ({ sprite: 'carriage' as const }))],
      },
      ariaLabel: `Tåg med ${numberWord(k)} vagnar`,
    }))
    return {
      id: `read.sentences.carriages:${n}`,
      skill: 'read.sentences',
      level,
      theme: 'train',
      prompt: 'Vilken bild passar meningen?',
      speech: `${text} Vilken bild passar meningen?`,
      // Extra support: the number as a digit next to the sentence.
      scene:
        support === 'extra'
          ? {
              kind: 'group',
              direction: 'column',
              scenes: [
                { kind: 'text', text, size: 'lg' },
                { kind: 'number', value: n },
              ],
            }
          : { kind: 'text', text, size: 'lg' },
      task: { kind: 'choice', choices, answer: String(n) },
      hints: withElim(
        {
          text: `Hur många vagnar? Leta efter ordet ${numberWord(n)}. Det är ${n}.`,
          scene: {
            kind: 'group',
            direction: 'column',
            scenes: [
              { kind: 'text', text, size: 'lg' },
              { kind: 'number', value: n },
            ],
          },
        },
        choices,
        String(n),
        'Vi tar bort en bild.',
      ),
      success: text,
    }
  },
}

interface Fact {
  text: string
  extra: string
  q: string
  sprite: SpriteId
}
const FACTS: Fact[] = [
  { text: 'Gripen är ett svenskt flygplan.', extra: 'Det flyger mycket snabbt.', q: 'Vad är Gripen?', sprite: 'jet' },
  { text: 'Spårvagnen åker på gatan.', extra: 'Den stannar vid hållplatser.', q: 'Vad åker på gatan?', sprite: 'tram' },
  {
    text: 'Tunnelbanan åker i tunnlar.',
    extra: 'Den stannar vid stationer.',
    q: 'Vad åker i tunnlar?',
    sprite: 'metroCar',
  },
  { text: 'Tåget åker på räls.', extra: 'Det stannar vid stationer.', q: 'Vad åker på räls?', sprite: 'locomotive' },
  {
    text: 'Flygplanet flyger i luften.',
    extra: 'Det landar på en flygplats.',
    q: 'Vad flyger i luften?',
    sprite: 'airliner',
  },
  {
    text: 'Resenären väntar på perrongen.',
    extra: 'Hen har en väska.',
    q: 'Vem väntar på perrongen?',
    sprite: 'passenger',
  },
]

/** One or two sentences, then a picture answer. */
export const whatIs: Generator = {
  id: 'read.sentences.whatIs',
  skill: 'read.sentences',
  levels: [3, 5],
  generate({ rng, level, support }) {
    const f = rng.pick(FACTS)
    const text = level >= 4 && support !== 'extra' ? `${f.text} ${f.extra}` : f.text
    const others = rng.shuffle(FACTS.filter((x) => x !== f)).slice(0, support === 'extra' ? 1 : 2)
    const choices: Choice[] = rng.shuffle([f, ...others]).map((x) => ({
      id: x.sprite,
      visual: { kind: 'row', items: [{ sprite: x.sprite }] },
      ariaLabel: SPRITE_NAMES[x.sprite],
    }))
    return {
      id: `read.sentences.whatIs:${f.sprite}:${text === f.text ? 1 : 2}`,
      skill: 'read.sentences',
      level,
      theme: f.sprite === 'jet' ? 'fighter' : 'train',
      prompt: f.q,
      speech: `${text} ${f.q}`,
      scene: { kind: 'text', text, size: support === 'extra' ? 'xl' : 'lg' },
      task: { kind: 'choice', choices, answer: f.sprite },
      hints: withElim(
        { text: 'Lyssna på meningen en gång till.', speech: text },
        choices,
        f.sprite,
        'Vi tar bort en bild.',
      ),
      success: text.split('. ')[0].replace(/\.?$/, '.'),
    }
  },
}

const PICTURE_SENTENCES: { noun: string; first: string; text: string; sprite: SpriteId }[] = [
  { noun: 'tåg', first: 'TÅGET', text: 'TÅGET ÅKER.', sprite: 'locomotive' },
  { noun: 'plan', first: 'PLANET', text: 'PLANET FLYGER.', sprite: 'airliner' },
  { noun: 'buss', first: 'BUSSEN', text: 'BUSSEN ÅKER.', sprite: 'bus' },
  { noun: 'bil', first: 'BILEN', text: 'BILEN ÅKER.', sprite: 'car' },
  { noun: 'spårvagn', first: 'SPÅRVAGNEN', text: 'SPÅRVAGNEN ÅKER.', sprite: 'tram' },
]

/** Levels 1-2: a two-word capital sentence, then pick the matching picture. */
export const pictureSentence: Generator = {
  id: 'read.sentences.picture',
  skill: 'read.sentences',
  levels: [1, 2],
  generate({ rng, level, support }) {
    // Level 1 avoids the long tram word.
    const pool = PICTURE_SENTENCES.filter((x) => level > 1 || x.noun !== 'spårvagn')
    const s = rng.pick(pool)
    const others = rng.shuffle(pool.filter((x) => x !== s)).slice(0, choiceCount(level, support) - 1)
    const choices: Choice[] = rng.shuffle([s, ...others]).map((x) => ({
      id: x.sprite,
      visual: { kind: 'row', items: [{ sprite: x.sprite }] },
      ariaLabel: SPRITE_NAMES[x.sprite],
    }))
    const sentence: Scene = { kind: 'text', text: s.text, size: 'xl' }
    return {
      id: `read.sentences.picture:${s.sprite}`,
      skill: 'read.sentences',
      level,
      theme: 'train',
      prompt: 'Vilken bild passar meningen?',
      speech: 'Läs meningen. Vilken bild passar?',
      // Extra support: the first word is also shown alone, large.
      scene:
        support === 'extra'
          ? { kind: 'group', direction: 'column', scenes: [sentence, { kind: 'sign', text: s.first, style: 'word' }] }
          : sentence,
      task: { kind: 'choice', choices, answer: s.sprite },
      hints: withElim(
        {
          text: `Läs första ordet: ${s.first}. Vilken bild är det?`,
          speech: `Första ordet är ${s.first.toLowerCase()}. Vilken bild passar?`,
          scene: { kind: 'sign', text: s.first, style: 'word' },
        },
        choices,
        s.sprite,
        'Vi tar bort en bild.',
      ),
      success: `Ja! ${s.text}`,
    }
  },
}
