import { createRng } from '../../src/core/rng'
import type { Level, Support } from '../../src/core/types'
import { GENERATORS } from '../../src/content'
import { VEHICLES } from '../../src/content/vehicles'
import { questionUtterances, speechKey, vehicleSpeech, type Utterance } from '../../src/lib/spoken'

/** Seeds without any new phrase before a generator/level/support combination counts as exhausted. */
const QUIET_SEEDS = 600
const MAX_SEEDS = 20000

/** Every text the app can speak, enumerated by running all generators until they stop producing new ones. */
export function collectUtterances(): (Utterance & { key: string })[] {
  const all = new Map<string, Utterance>()
  const add = (u: Utterance) => all.set(speechKey(u), { text: u.text.trim(), lang: u.lang })
  for (const g of GENERATORS)
    for (let level = g.levels[0]; level <= g.levels[1]; level++)
      for (const support of ['normal', 'extra'] as Support[]) {
        let quiet = 0
        for (let seed = 1; seed <= MAX_SEEDS && quiet < QUIET_SEEDS; seed++) {
          const before = all.size
          const q = g.generate({ rng: createRng(seed * 2654435761), level: level as Level, support })
          questionUtterances(q).forEach(add)
          quiet = all.size > before ? 0 : quiet + 1
        }
      }
  for (const v of VEHICLES) add({ text: vehicleSpeech(v), lang: 'sv' })
  return [...all].map(([key, u]) => ({ key, ...u })).sort((a, b) => a.key.localeCompare(b.key))
}
