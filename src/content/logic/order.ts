import type { Choice, Generator, Scene } from '../../core/types'
import { numberWord } from '../../core/swedish'
import { wrongIds } from '../helpers'

const count = (level: number) => (level <= 2 ? 3 : level <= 4 ? 4 : 5)

/** Göteborg tram stops (names verified to exist). The map order is made up per question: the task is to read it. */
export const TRAM_STOPS = [
  'Brunnsparken',
  'Järntorget',
  'Centralstationen',
  'Korsvägen',
  'Chalmers',
  'Linnéplatsen',
  'Domkyrkan',
  'Kungsportsplatsen',
  'Valand',
  'Vasaplatsen',
]

export function routeScene(stops: string[]): Scene {
  const scenes: Scene[] = []
  stops.forEach((text, i) => {
    if (i) scenes.push({ kind: 'text', text: '→' })
    scenes.push({ kind: 'sign', text, style: 'station' })
  })
  return { kind: 'group', direction: 'row', scenes }
}

/** Order trains by length (1–5 cars). */
export const trainLengthOrder: Generator = {
  id: 'logic.order.trainLength',
  skill: 'logic.order',
  levels: [1, 5],
  generate({ rng, level }) {
    const lens = rng.shuffle([1, 2, 3, 4, 5]).slice(0, count(level))
    const shortFirst = level < 4 || rng.next() < 0.5
    const items: Choice[] = lens.map((n) => ({
      id: `n${n}`,
      visual: { kind: 'row', items: Array.from({ length: n }, () => ({ sprite: 'carriage' as const })) },
      ariaLabel: `Tåg med ${numberWord(n, 'en')} ${n === 1 ? 'vagn' : 'vagnar'}`,
    }))
    const sorted = [...lens].sort((a, b) => (shortFirst ? a - b : b - a))
    const first = sorted[0]
    return {
      id: `logic.order.trainLength:${shortFirst ? 'up' : 'down'}:${[...lens].sort().join('')}`,
      skill: 'logic.order',
      level,
      theme: 'train',
      prompt: shortFirst ? 'Tryck på tågen. Kortaste först.' : 'Tryck på tågen. Längsta först.',
      task: { kind: 'order', items, answer: sorted.map((n) => `n${n}`) },
      hints: [
        { text: 'Räkna vagnarna i varje tåg.' },
        { text: `Först kommer tåget med ${numberWord(first, 'en')} ${first === 1 ? 'vagn' : 'vagnar'}.` },
      ],
      success: shortFirst ? 'Ja! Från kortaste till längsta tåget.' : 'Ja! Från längsta till kortaste tåget.',
    }
  },
}

/** Read the tram map and tap the stops in the same order. */
export const tramStopsOrder: Generator = {
  id: 'logic.order.tramStops',
  skill: 'logic.order',
  levels: [1, 5],
  generate({ rng, level }) {
    const stops = rng.shuffle(TRAM_STOPS).slice(0, count(level))
    const items: Choice[] = rng.shuffle(stops).map((s) => ({ id: s, label: s }))
    return {
      id: `logic.order.tramStops:${stops.join('>')}`,
      skill: 'logic.order',
      level,
      theme: 'tram',
      prompt: 'Titta på kartan. Tryck på hållplatserna i samma ordning.',
      scene: routeScene(stops),
      task: { kind: 'order', items, answer: stops },
      hints: [{ text: 'Börja längst till vänster på kartan. Följ pilarna.' }, { text: `Först kommer ${stops[0]}.` }],
      success: 'Ja! Du läste kartan rätt.',
    }
  },
}

/** Numbered carriages: board 1-2-3-4 (backwards at the higher levels). */
export const carriageNumberOrder: Generator = {
  id: 'logic.order.carriageNumbers',
  skill: 'logic.order',
  levels: [1, 5],
  generate({ rng, level }) {
    const n = count(level)
    const up = level < 4 || rng.next() < 0.5
    const nums = Array.from({ length: n }, (_, i) => i + 1)
    const items: Choice[] = rng.shuffle(nums).map((k) => ({
      id: `v${k}`,
      label: String(k),
      visual: { kind: 'row', items: [{ sprite: 'carriage' }] },
      ariaLabel: `Vagn ${k}`,
    }))
    const answer = (up ? nums : [...nums].reverse()).map((k) => `v${k}`)
    return {
      id: `logic.order.carriageNumbers:${up ? 'up' : 'down'}:${n}`,
      skill: 'logic.order',
      level,
      theme: 'train',
      prompt: up ? `Gå ombord i ordning: vagn 1 till vagn ${n}.` : `Gå ombord baklänges: vagn ${n} till vagn 1.`,
      task: { kind: 'order', items, answer },
      hints: [
        { text: up ? 'Börja med vagnen med en etta.' : `Börja med vagnen med en ${n}:a.` },
        { text: `Först kommer vagn ${up ? 1 : n}.` },
      ],
      success: 'Ja! Alla vagnar är i rätt ordning.',
    }
  },
}

/** "Vilken hållplats kommer efter Järntorget?" with the map shown. */
export const tramRouteQuestion: Generator = {
  id: 'logic.order.tramRoute',
  skill: 'logic.order',
  levels: [2, 5],
  generate({ rng, level }) {
    const stops = rng.shuffle(TRAM_STOPS).slice(0, level <= 2 ? 4 : 5)
    const mode = level <= 3 ? 'after' : rng.pick(['after', 'before'] as const)
    const i = mode === 'after' ? rng.int(0, stops.length - 2) : rng.int(1, stops.length - 1)
    const ref = stops[i]
    const answer = stops[mode === 'after' ? i + 1 : i - 1]
    const choices: Choice[] = rng.shuffle(stops.filter((s) => s !== ref)).map((s) => ({ id: s, label: s }))
    return {
      id: `logic.order.tramRoute:${mode}:${stops.join('>')}:${ref}`,
      skill: 'logic.order',
      level,
      theme: 'tram',
      prompt: `Vilken hållplats kommer ${mode === 'after' ? 'efter' : 'före'} ${ref}?`,
      scene: routeScene(stops),
      task: { kind: 'choice', choices, answer },
      hints: [
        { text: `Leta upp ${ref} på kartan. Pilarna visar vägen.` },
        { text: `Det är ${answer}.`, eliminate: wrongIds(choices, answer, 1) },
      ],
      success: `Ja! ${answer} kommer ${mode === 'after' ? 'efter' : 'före'} ${ref}.`,
    }
  },
}
