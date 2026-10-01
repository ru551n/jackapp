import type { Generator } from '../../core/types'
import { textChoices, wrongIds } from '../helpers'

const STATIONS_EASY = ['SLUSSEN', 'ODENPLAN', 'FRIDHEMSPLAN', 'GULLMARSPLAN', 'KISTA', 'SKANSTULL']

/** "Tryck på SLUSSEN." — find the named station sign among a few. */
export const findStationSign: Generator = {
  id: 'read.words.stationSign',
  skill: 'read.words',
  levels: [1, 5],
  generate({ rng, level }) {
    const answer = rng.pick(STATIONS_EASY)
    const choices = textChoices(rng, answer, STATIONS_EASY, level <= 2 ? 2 : 3).map((c) => ({
      ...c,
      label: undefined,
      visual: { kind: 'sign' as const, text: c.id, style: 'station' as const },
      ariaLabel: c.id,
    }))
    return {
      id: `read.words.stationSign:${answer}:${choices.length}`,
      skill: 'read.words',
      level,
      theme: 'metro',
      prompt: `Tryck på skylten där det står ${answer}.`,
      scene: { kind: 'text', text: answer, size: 'lg' },
      task: { kind: 'choice', choices, answer },
      hints: [
        { text: `${answer} börjar på ${answer[0]}.` },
        { text: 'Titta på första bokstaven.', eliminate: wrongIds(choices, answer) },
      ],
      success: `Ja, det står ${answer}.`,
    }
  },
}
