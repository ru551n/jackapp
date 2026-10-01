import type { Generator } from '../../core/types'
import { wrongIds } from '../helpers'
import { COLORS, VEHICLES, ask, colourPic, wordSign } from './vocab'

/** Colours on vehicles: "Tryck på red." → "Tap the blue train." */
export const tapColor: Generator = {
  id: 'en.colors.tapColor',
  skill: 'en.colors',
  levels: [1, 5],
  generate({ rng, level, support }) {
    const [c, c2, c3] = rng.shuffle(COLORS)
    const [n, n2, n3] = rng.shuffle(VEHICLES)
    const four: [typeof c, typeof n][] = [
      [c, n],
      [c2, n],
      [c, n2],
      [c3, n3],
    ]
    const pairs =
      level <= 3
        ? [c, c2, c3].slice(0, level <= 1 || support === 'extra' ? 2 : 3).map((x): [typeof c, typeof n] => [x, n])
        : four.slice(0, level >= 5 && support !== 'extra' ? 4 : 3)
    const [tc, tn] = pairs[0]
    const choices = rng.shuffle(pairs).map(([x, v]) => colourPic(x, v))
    const answer = `${tc.tint}:${tn.en}`
    const simple = level <= 2
    const phrase = simple ? tc.en : `${tc.en} ${tn.en}`
    return {
      id: `en.colors.tapColor:${answer}:${choices
        .map((x) => x.id)
        .sort()
        .join('-')}`,
      skill: 'en.colors',
      level,
      theme: tn.theme,
      ...ask(level, support, { sv: `Tryck på ${phrase}.`, en: `Tap the ${phrase}.`, say: phrase }),
      scene: level <= 2 || support === 'extra' ? wordSign(tc.en) : undefined,
      task: { kind: 'choice', choices, answer },
      hints: [
        { text: `${tc.en} betyder ${tc.sv}.`, scene: wordSign(tc.en) },
        {
          text: simple ? `Leta efter ${tc.sv} färg.` : `Hitta ${tn.neuter ? tc.svT : tc.sv} ${tn.sv}.`,
          eliminate: wrongIds(choices, answer),
        },
      ],
      success: `Ja! ${tc.en} = ${tc.sv}.`,
    }
  },
}
