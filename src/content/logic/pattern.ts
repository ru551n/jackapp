import type { Generator, SceneItem, Tint } from '../../core/types'
import { TINT_NAMES } from '../helpers'

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
