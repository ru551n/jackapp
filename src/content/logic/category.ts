import type { Choice, Generator, SpriteId } from '../../core/types'
import { choiceCount, wrongIds } from '../helpers'

export type Kind = 'tåg' | 'spårvagn' | 'tunnelbana' | 'passagerarflygplan' | 'stridsflygplan'
export const KIND_SPRITE: Record<Kind, SpriteId> = {
  tåg: 'locomotive',
  spårvagn: 'tram',
  tunnelbana: 'metroCar',
  passagerarflygplan: 'airliner',
  stridsflygplan: 'jet',
}
const SINGULAR: Record<Kind, string> = {
  tåg: 'ett tåg',
  spårvagn: 'en spårvagn',
  tunnelbana: 'en tunnelbanevagn',
  passagerarflygplan: 'ett passagerarflygplan',
  stridsflygplan: 'ett stridsflygplan',
}
export const RAIL_KINDS: Kind[] = ['tåg', 'spårvagn', 'tunnelbana']
export const AIR_KINDS: Kind[] = ['passagerarflygplan', 'stridsflygplan']
const ALL = [...RAIL_KINDS, ...AIR_KINDS]
export const isRail = (k: Kind) => RAIL_KINDS.includes(k)

const pic = (id: string, kind: Kind): Choice => ({
  id,
  visual: { kind: 'row', items: [{ sprite: KIND_SPRITE[kind] }] },
  ariaLabel: kind === 'tunnelbana' ? 'tunnelbanevagn' : kind,
})

/** Vilken hör inte hit? Three of one kind and one of another. Choice ids are `${kind}:${index}`. */
export const oddOneOut: Generator = {
  id: 'logic.category.oddOneOut',
  skill: 'logic.category',
  levels: [1, 5],
  generate({ rng, level, support }) {
    const extra = support === 'extra'
    const [same, odd]: Kind[] =
      level <= 2 || extra
        ? [rng.pick(RAIL_KINDS), rng.pick(AIR_KINDS)]
        : level === 3
          ? rng.shuffle(RAIL_KINDS)
          : rng.shuffle(ALL)
    const kinds = rng.shuffle(extra ? [same, same, odd] : [same, same, same, odd])
    const choices = kinds.map((k, i) => pic(`${k}:${i}`, k))
    const answer = choices[kinds.indexOf(odd)].id
    return {
      id: `logic.category.oddOneOut:${same}+${odd}`,
      skill: 'logic.category',
      level,
      theme: isRail(same) ? 'tram' : 'airport',
      prompt: 'Vilken hör inte hit?',
      task: { kind: 'choice', choices, answer },
      hints: [
        {
          text:
            isRail(same) === isRail(odd)
              ? `Leta efter ${SINGULAR[odd]}.`
              : isRail(odd)
                ? 'Leta efter något som går på spår.'
                : 'Leta efter något som flyger.',
        },
        { text: 'De andra är likadana. Hitta den som är annorlunda.', eliminate: wrongIds(choices, answer, 1) },
      ],
      success: `Ja! Det är ${SINGULAR[odd]}.`,
    }
  },
}

/** Vilken är ett flygplan? / Vilken går på spår? */
export const railOrAir: Generator = {
  id: 'logic.category.railOrAir',
  skill: 'logic.category',
  levels: [1, 3],
  generate({ rng, level, support }) {
    const air = rng.next() < 0.5
    const kinds = air ? [rng.pick(AIR_KINDS), ...rng.shuffle(RAIL_KINDS)] : [rng.pick(RAIL_KINDS), ...AIR_KINDS]
    const n = Math.min(3, choiceCount(level, support))
    const picked = [kinds[0], ...rng.shuffle(kinds.slice(1)).slice(0, n - 1)]
    const choices = rng.shuffle(picked).map((k) => pic(k, k))
    const answer = picked[0]
    return {
      id: `logic.category.railOrAir:${air ? 'air' : 'rail'}:${[...picked].sort().join('+')}`,
      skill: 'logic.category',
      level,
      theme: air ? 'airport' : 'train',
      prompt: air ? rng.pick(['Vilken är ett flygplan?', 'Vilken flyger?']) : 'Vilken går på spår?',
      task: { kind: 'choice', choices, answer },
      hints: [
        { text: air ? 'Flygplan har vingar.' : 'Tåg, spårvagnar och tunnelbana går på spår.' },
        { text: `Det är ${SINGULAR[answer]}.`, eliminate: wrongIds(choices, answer, 1) },
      ],
      success: `Ja! Det är ${SINGULAR[answer]}.`,
    }
  },
}

/** Sorting a vehicle into its kind. */
export const nameTheKind: Generator = {
  id: 'logic.category.nameTheKind',
  skill: 'logic.category',
  levels: [2, 5],
  generate({ rng, level, support }) {
    const kind = rng.pick(ALL)
    const n = choiceCount(level, support)
    // Extra support: one clear contrast, rail vs air.
    const pool = ALL.filter((k) => k !== kind && (support !== 'extra' || isRail(k) !== isRail(kind)))
    const others = rng.shuffle(pool).slice(0, n - 1)
    const choices = rng.shuffle([kind, ...others]).map((k) => ({ id: k, label: k }))
    return {
      id: `logic.category.nameTheKind:${kind}:${n}`,
      skill: 'logic.category',
      level,
      theme: isRail(kind) ? 'tram' : 'airport',
      prompt: 'Vad är det här?',
      scene: { kind: 'row', items: [{ sprite: KIND_SPRITE[kind] }], label: kind },
      task: { kind: 'choice', choices, answer: kind },
      hints: [
        { text: isRail(kind) ? 'Den går på spår.' : 'Den flyger.' },
        { text: `Det är ${SINGULAR[kind]}.`, eliminate: wrongIds(choices, kind, 1) },
      ],
      success: `Ja! Det är ${SINGULAR[kind]}.`,
    }
  },
}
