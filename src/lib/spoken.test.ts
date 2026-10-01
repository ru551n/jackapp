import { describe, expect, it } from 'vitest'
import { collectUtterances } from '../../scripts/speech/phrases'
import { createRng } from '../core/rng'
import type { Level, Support } from '../core/types'
import { GENERATORS } from '../content'
import { questionUtterances, speechKey } from './spoken'

describe('speech keys', () => {
  it('are stable, language-specific and trim whitespace', () => {
    const k = speechKey({ text: 'Tryck på train.', lang: 'sv' })
    expect(k).toMatch(/^[0-9a-f]{16}$/)
    expect(speechKey({ text: ' Tryck på train. ', lang: 'sv' })).toBe(k)
    expect(speechKey({ text: 'Tryck på train.', lang: 'en' })).not.toBe(k)
  })
})

describe('build-time phrase collection', () => {
  const collected = new Set(collectUtterances().map((u) => u.key))

  it('covers questions from seeds it never used', () => {
    const missing: string[] = []
    for (let seed = 900_001; seed <= 900_060; seed++)
      for (const g of GENERATORS)
        for (let level = g.levels[0]; level <= g.levels[1]; level++)
          for (const support of ['normal', 'extra'] as Support[]) {
            const q = g.generate({ rng: createRng(seed), level: level as Level, support })
            for (const u of questionUtterances(q)) if (!collected.has(speechKey(u))) missing.push(`${g.id}: ${u.text}`)
          }
    // A rare miss falls back to in-app synthesis; this guards against whole templates going missing.
    expect(missing.length, missing.slice(0, 5).join('\n')).toBeLessThanOrEqual(3)
  })
})
