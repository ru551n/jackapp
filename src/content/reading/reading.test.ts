import { describe, expect, it } from 'vitest'
import { createRng } from '../../core/rng'
import { READING_GENERATORS } from './index'
import { missingLetter } from './missingLetter'
import { carriageCount, whatIs } from './sentences'

const run = (g: (typeof READING_GENERATORS)[number], level: 1 | 2 | 3 | 4 | 5, seed: number) =>
  g.generate({ rng: createRng(seed), level, support: 'normal' })

describe('reading content', () => {
  it('covers all four skills across levels 1–5', () => {
    expect(new Set(READING_GENERATORS.map((g) => g.skill)).size).toBe(4)
    for (const l of [1, 2, 3, 4, 5])
      expect(READING_GENERATORS.some((g) => g.levels[0] <= l && l <= g.levels[1])).toBe(true)
    expect(READING_GENERATORS.length).toBeGreaterThanOrEqual(7)
  })

  it('missing letter: answer completes the word and is uppercase at level 2', () => {
    for (let seed = 1; seed < 40; seed++) {
      const q = run(missingLetter, 2, seed)
      const [, word, rest] = q.id.split(':')
      const [letter, idx] = rest.split('@')
      expect(word[Number(idx)]).toBe(letter)
      expect(q.task.kind === 'choice' && q.task.answer).toBe(letter)
      expect(letter).toBe(letter.toUpperCase())
    }
  })

  it('carriage sentences match the picture answer', () => {
    for (let seed = 1; seed < 20; seed++) {
      const q = run(carriageCount, 3, seed)
      if (q.task.kind !== 'choice') throw new Error('choice')
      const choice = q.task.choices.find((c) => c.id === q.task.answer)
      const items = choice?.visual?.kind === 'row' ? choice.visual.items : []
      expect(items.filter((i) => i.sprite === 'carriage').length).toBe(Number(q.task.answer))
    }
  })

  it('Gripen sentence asks for the jet', () => {
    const qs = Array.from({ length: 60 }, (_, s) => run(whatIs, 3, s))
    const gripen = qs.find((q) => q.id.includes(':jet:'))
    expect(gripen?.prompt).toBe('Vad är Gripen?')
  })
})
