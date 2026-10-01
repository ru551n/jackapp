import { numberWord } from '../../core/swedish'
import type { Generator } from '../../core/types'
import { wrongIds } from '../helpers'

/** "Ditt flyg går från gate 4. Tryck på rätt gate." */
export const findGate: Generator = {
  id: 'air.numbers.gate',
  skill: 'air.numbers',
  levels: [1, 5],
  generate({ rng, level }) {
    const max = level <= 1 ? 5 : level <= 3 ? 10 : 20
    const count = level <= 2 ? 3 : 4
    const start = rng.int(1, max - count + 1)
    const gates = Array.from({ length: count }, (_, i) => start + i)
    const answer = rng.pick(gates)
    const choices = gates.map((g) => ({
      id: String(g),
      visual: { kind: 'sign' as const, text: `Gate ${g}`, style: 'gate' as const },
      ariaLabel: `Gate ${g}`,
    }))
    return {
      id: `air.numbers.gate:${start}-${count}:${answer}`,
      skill: 'air.numbers',
      level,
      theme: 'airport',
      prompt: `Ditt flyg går från gate ${answer}. Tryck på rätt gate.`,
      speech: `Ditt flyg går från gate ${numberWord(answer)}. Tryck på rätt gate.`,
      scene: { kind: 'sign', text: `Gate ${answer}`, style: 'departure' },
      task: { kind: 'choice', choices, answer: String(answer) },
      hints: [
        { text: `Leta efter siffran ${answer}.` },
        { text: `Det står ${answer} på skylten.`, eliminate: wrongIds(choices, String(answer)) },
      ],
      success: `Ja! Gate ${answer}. Dags att gå ombord.`,
    }
  },
}
