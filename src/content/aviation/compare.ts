import type { Generator, Vehicle } from '../../core/types'
import { wrongIds } from '../helpers'
import { AIRCRAFT } from '../vehicles/aircraft'
import { pictureChoice, qid } from './common'

type Num = (v: Vehicle) => number | undefined
const engines: Num = (v) => v.specs.engines
const length: Num = (v) => v.specs.lengthM
const year: Num = (v) => v.specs.firstYear
/** Only aircraft whose spec is verified take part in a comparison. */
const withSpec = (get: Num) => AIRCRAFT.filter((v) => get(v) !== undefined)

const ENGINE_WORD: Record<number, string> = { 1: 'en motor', 2: 'två motorer', 4: 'fyra motorer' }

/** "Vilket flygplan har två motorer?" */
export const compareEngines: Generator = {
  id: 'air.compare.engines',
  skill: 'air.compare',
  levels: [2, 4],
  generate({ rng, level, support }) {
    const n = rng.pick(level === 2 ? [1, 2] : [1, 2, 4])
    const pool = withSpec(engines)
    const answer = rng.pick(pool.filter((v) => engines(v) === n))
    const count = support === 'extra' || level === 2 ? 2 : 3
    const wrong = rng.shuffle(pool.filter((v) => engines(v) !== n)).slice(0, count - 1)
    const options = rng.shuffle([answer, ...wrong])
    const choices = options.map((v, i) => pictureChoice(v, i))
    return {
      id: qid(
        'air.compare.engines',
        String(n),
        answer.id,
        options.map((v) => v.id),
      ),
      skill: 'air.compare',
      level,
      theme: answer.category === 'fighter' ? 'fighter' : 'airport',
      prompt: `Vilket flygplan har ${ENGINE_WORD[n]}?`,
      task: { kind: 'choice', choices, answer: answer.id },
      hints: [
        { text: `Räkna motorerna på varje flygplan. Leta efter ${ENGINE_WORD[n]}.` },
        { text: `${answer.shortName} har ${ENGINE_WORD[n]}.`, eliminate: wrongIds(choices, answer.id) },
      ],
      success: `Ja! ${answer.shortName} har ${ENGINE_WORD[n]}.`,
    }
  },
}

/** Pick `count` aircraft with clearly different lengths (at least 10% apart). */
function distinctBy(rng: Parameters<Generator['generate']>[0]['rng'], get: Num, count: number, gap: number) {
  const pool = withSpec(get)
  for (let i = 0; i < 50; i++) {
    const s = rng.shuffle(pool).slice(0, count)
    const vals = s.map((v) => get(v)!).sort((a, b) => a - b)
    if (vals.every((x, j) => j === 0 || x >= vals[j - 1] * gap)) return s
  }
  return pool.filter((v) => ['a380', 'gripen', 'a320'].includes(v.id)).slice(0, count)
}

/** "Vilket flygplan är längst/kortast?" Pictures are drawn relative to the longest. */
export const compareLength: Generator = {
  id: 'air.compare.length',
  skill: 'air.compare',
  levels: [2, 5],
  generate({ rng, level, support }) {
    const count = support === 'extra' || level === 2 ? 2 : 3
    const options = distinctBy(rng, length, count, 1.1)
    const shortest = level >= 4 && rng.next() < 0.5
    const sorted = [...options].sort((a, b) => length(a)! - length(b)!)
    const answer = shortest ? sorted[0] : sorted[sorted.length - 1]
    const longest = length(sorted[sorted.length - 1])!
    const choices = options.map((v, i) => ({
      ...pictureChoice(v, i),
      visual: { kind: 'vehicle' as const, vehicle: v.id, scale: Math.max(0.2, length(v)! / longest) },
    }))
    const word = shortest ? 'kortast' : 'längst'
    return {
      id: qid(
        'air.compare.length',
        word,
        answer.id,
        options.map((v) => v.id),
      ),
      skill: 'air.compare',
      level,
      theme: 'airport',
      prompt: `Vilket flygplan är ${word}?`,
      task: { kind: 'choice', choices, answer: answer.id },
      hints: [
        { text: `Titta på flygplanens storlek. Leta efter det ${shortest ? 'minsta' : 'största'}.` },
        { text: `${answer.shortName} är ${word}.`, eliminate: wrongIds(choices, answer.id) },
      ],
      success: `Ja! ${answer.shortName} är ${word}.`,
    }
  },
}

/** "Vilket flygplan flög först?" Years are shown next to the pictures. */
export const compareFirstFlight: Generator = {
  id: 'air.compare.first',
  skill: 'air.compare',
  levels: [4, 5],
  generate({ rng, level, support }) {
    const count = support === 'extra' || level === 4 ? 2 : 3
    const pool = withSpec(year)
    let options: Vehicle[] = []
    for (let i = 0; i < 50; i++) {
      options = rng.shuffle(pool).slice(0, count)
      if (new Set(options.map(year)).size === count) break
    }
    const oldest = [...options].sort((a, b) => year(a)! - year(b)!)[0]
    const choices = options.map((v, i) => pictureChoice(v, i, undefined, `${v.shortName} ${year(v)}`))
    return {
      id: qid(
        'air.compare.first',
        'year',
        oldest.id,
        options.map((v) => v.id),
      ),
      skill: 'air.compare',
      level,
      theme: 'airport',
      prompt: 'Vilket flygplan flög först? Titta på årtalen.',
      task: { kind: 'choice', choices, answer: oldest.id },
      hints: [
        { text: 'Det minsta årtalet är det äldsta flygplanet.' },
        { text: `${oldest.shortName} flög första gången ${year(oldest)}.`, eliminate: wrongIds(choices, oldest.id) },
      ],
      success: `Ja! ${oldest.shortName} flög först, år ${year(oldest)}.`,
    }
  },
}
