import type {
  Choice,
  GenContext,
  Generator,
  Level,
  Question,
  Rng,
  Scene,
  SceneItem,
  SpriteId,
  Tint,
} from '../../core/types'
import { TINT_NAMES, wrongIds } from '../helpers'

const TINTS: Tint[] = ['red', 'blue', 'green', 'yellow']

/** red, blue, red, blue, ? — continue a tram colour pattern. */
export const tramColourPattern: Generator = {
  id: 'logic.pattern.tramColours',
  skill: 'logic.pattern',
  levels: [1, 5],
  generate({ rng, level }) {
    const unitLen = level <= 2 ? 2 : 3
    const unit = rng.shuffle(TINTS).slice(0, unitLen)
    const shown = level <= 1 ? 4 : unitLen * 2
    const seq = Array.from({ length: shown + 1 }, (_, i) => unit[i % unitLen])
    const answer = seq[shown]
    const items: SceneItem[] = seq.slice(0, shown).map((tint) => ({ sprite: 'tram', tint }))
    const others = rng.shuffle(TINTS.filter((t) => t !== answer)).slice(0, 2)
    const choices = rng.shuffle([answer, ...others]).map((tint) => ({
      id: tint,
      visual: { kind: 'row' as const, items: [{ sprite: 'tram' as const, tint }] },
      ariaLabel: `${TINT_NAMES[tint].indef} spårvagn`,
    }))
    return {
      id: `logic.pattern.tramColours:${unit.join('-')}:${shown}`,
      skill: 'logic.pattern',
      level,
      theme: 'tram',
      prompt: 'Vilken spårvagn kommer sen?',
      scene: {
        kind: 'row',
        items,
        label: `Spårvagnar: ${seq
          .slice(0, shown)
          .map((t) => TINT_NAMES[t].indef)
          .join(', ')}`,
      },
      task: { kind: 'choice', choices, answer },
      hints: [
        {
          text: 'Titta på färgerna. De kommer i samma ordning igen.',
          scene: { kind: 'row', items: items.map((it, i) => ({ ...it, group: Math.floor(i / unitLen) })) },
        },
        { text: `Nästa spårvagn är ${TINT_NAMES[answer].indef}.`, eliminate: [others[0]] },
      ],
      success: `Ja! Den ${TINT_NAMES[answer].def} spårvagnen kommer sen.`,
    }
  },
}

// ---- Unit patterns (AB / AAB / ABB / ABC), optionally with the gap in the middle ----

type Sym = { sprite: SpriteId; tint?: Tint }
const SPRITE_NAME: Partial<Record<SpriteId, { a: string; def: string }>> = {
  tram: { a: 'en spårvagn', def: 'spårvagnen' },
  metroCar: { a: 'en tunnelbanevagn', def: 'tunnelbanevagnen' },
  locomotive: { a: 'ett lok', def: 'loket' },
  carriage: { a: 'en tågvagn', def: 'tågvagnen' },
}
const RAIL: SpriteId[] = ['tram', 'metroCar', 'locomotive', 'carriage']
const symName = (s: Sym) => (s.tint ? `${TINT_NAMES[s.tint].indef} ` : '') + SPRITE_NAME[s.sprite]!.a.split(' ')[1]
const symKey = (s: Sym) => `${s.sprite}${s.tint ? `-${s.tint}` : ''}`
const symA = (s: Sym) => {
  const [art, noun] = SPRITE_NAME[s.sprite]!.a.split(' ')
  return s.tint ? `${art} ${TINT_NAMES[s.tint].indef} ${noun}` : SPRITE_NAME[s.sprite]!.a
}

function buildPattern(
  idBase: string,
  { rng, level }: Pick<GenContext, 'rng' | 'level'>,
  pool: Sym[],
  shapes: string[],
  mid: boolean,
): Question {
  const shape = rng.pick(shapes)
  const letters = [...new Set(shape)]
  const unit = rng.shuffle(pool).slice(0, letters.length)
  const sym = (ch: string) => unit[letters.indexOf(ch)]
  const total = shape.length * 2 + 1
  const miss = mid ? rng.int(2, total - 3) : total - 1
  const seq = Array.from({ length: total }, (_, i) => sym(shape[i % shape.length]))
  const answer = seq[miss]
  const toItems = (from: number, to: number, grouped: boolean): SceneItem[] =>
    seq.slice(from, to).map((s, i) => ({ ...s, group: grouped ? Math.floor((from + i) / shape.length) : undefined }))
  const label = (xs: Sym[]) => `Rad: ${xs.map(symName).join(', ')}`
  const build = (grouped: boolean): Scene => {
    if (!mid) return { kind: 'row', items: toItems(0, miss, grouped), label: label(seq.slice(0, miss)) }
    return {
      kind: 'group',
      direction: 'row',
      scenes: [
        { kind: 'row', items: toItems(0, miss, grouped), label: label(seq.slice(0, miss)) },
        { kind: 'text', text: '?', size: 'xl' },
        { kind: 'row', items: toItems(miss + 1, total, grouped), label: label(seq.slice(miss + 1)) },
      ],
    }
  }
  const wrong = rng.shuffle(pool.filter((p) => symKey(p) !== symKey(answer))).slice(0, level <= 1 ? 1 : 2)
  const choices: Choice[] = rng.shuffle([answer, ...wrong]).map((s) => ({
    id: symKey(s),
    visual: { kind: 'row', items: [{ ...s }] },
    ariaLabel: symName(s),
  }))
  const ans = symKey(answer)
  return {
    id: `${idBase}:${shape}:${unit.map(symKey).join('-')}:${miss}`,
    skill: 'logic.pattern',
    level,
    theme: 'tram',
    prompt: mid ? 'Vad saknas i raden?' : 'Vad kommer sen?',
    scene: build(false),
    task: { kind: 'choice', choices, answer: ans },
    hints: [
      { text: 'Titta på raden. Samma vagnar kommer igen och igen.', scene: build(true) },
      { text: `Det är ${symA(answer)}.`, eliminate: wrongIds(choices, ans, 1).slice(0, 1) },
    ],
    success: `Ja! Det är ${symA(answer)}.`,
  }
}

const midChance = (level: Level, rng: Rng) => level >= 5 && rng.next() < 0.5

/** tram, metroCar, tram, metroCar, ? — vehicle-type patterns. */
export const vehicleTypePattern: Generator = {
  id: 'logic.pattern.vehicleTypes',
  skill: 'logic.pattern',
  levels: [1, 5],
  generate(ctx) {
    const { level, rng } = ctx
    const shapes = level <= 2 ? ['AB'] : level === 3 ? ['AB', 'AAB'] : ['AAB', 'ABB', 'ABC']
    const pool: Sym[] = RAIL.map((sprite) => ({ sprite }))
    return buildPattern('logic.pattern.vehicleTypes', ctx, pool, shapes, midChance(level, rng))
  },
}

/** Coloured-unit patterns: AAB, ABB, ABC in tram/metro/train colours. */
export const colourUnitPattern: Generator = {
  id: 'logic.pattern.colourUnits',
  skill: 'logic.pattern',
  levels: [2, 5],
  generate(ctx) {
    const { level, rng } = ctx
    const sprite = rng.pick<SpriteId>(['tram', 'metroCar', 'carriage'])
    const shapes = level <= 2 ? ['AB'] : level === 3 ? ['AAB', 'ABB'] : ['AAB', 'ABB', 'ABC']
    const pool: Sym[] = TINTS.map((tint) => ({ sprite, tint }))
    return buildPattern('logic.pattern.colourUnits', ctx, pool, shapes, midChance(level, rng))
  },
}
