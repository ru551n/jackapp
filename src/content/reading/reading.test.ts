import { describe, expect, it } from 'vitest'
import { createRng } from '../../core/rng'
import { READING_GENERATORS } from './index'
import { missingLetter } from './missingLetter'
import { startsWith } from './letters'
import { carriageCount, pictureSentence, whatIs } from './sentences'

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

  it('missing letter level 1: picture shown, first letter missing, 2 choices', () => {
    for (let seed = 1; seed < 30; seed++) {
      const q = run(missingLetter, 1, seed)
      if (q.task.kind !== 'choice') throw new Error('choice')
      expect(q.id.endsWith('@0')).toBe(true)
      expect(q.task.choices).toHaveLength(2)
      expect(JSON.stringify(q.scene)).toContain('"sprite"')
    }
  })

  it('missing letter: all choices share the answer case', () => {
    for (const level of [1, 2, 3, 4, 5] as const)
      for (let seed = 1; seed < 40; seed++) {
        const q = run(missingLetter, level, seed)
        if (q.task.kind !== 'choice') throw new Error('choice')
        const lower = level >= 3
        for (const c of q.task.choices) expect(c.id === c.id.toLowerCase(), `${q.id} ${c.id}`).toBe(lower)
      }
  })

  it('letters level 1: short picture word, distractors not in the word', () => {
    for (let seed = 1; seed < 30; seed++) {
      const q = run(startsWith, 1, seed)
      if (q.task.kind !== 'choice') throw new Error('choice')
      const word = q.id.split(':')[1]
      expect(word.length).toBeLessThanOrEqual(4)
      for (const c of q.task.choices.filter((c) => c.id !== q.task.answer)) expect(word).not.toContain(c.id)
    }
  })

  it('sentences level 1: two-word capital sentence with 2 picture choices', () => {
    for (let seed = 1; seed < 20; seed++) {
      const q = run(pictureSentence, 1, seed)
      if (q.task.kind !== 'choice') throw new Error('choice')
      expect(q.task.choices).toHaveLength(2)
      expect(q.scene?.kind === 'text' && q.scene.text.split(' ')).toHaveLength(2)
    }
  })
})
