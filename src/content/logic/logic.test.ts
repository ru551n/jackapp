import { describe, expect, it } from 'vitest'
import { createRng } from '../../core/rng'
import type { Level, Question } from '../../core/types'
import { KIND_SPRITE, isRail, type Kind } from './category'
import { LOGIC_GENERATORS } from './index'

const LEVELS: Level[] = [1, 2, 3, 4, 5]
const SEEDS = Array.from({ length: 40 }, (_, i) => i * 31 + 3)

function each(genId: string, fn: (q: Question, level: Level) => void) {
  const gen = LOGIC_GENERATORS.find((g) => g.id === genId)!
  for (const level of LEVELS) {
    if (level < gen.levels[0] || level > gen.levels[1]) continue
    for (const seed of SEEDS) fn(gen.generate({ rng: createRng(seed), level, support: 'normal' }), level)
  }
}

describe('patterns', () => {
  for (const id of ['logic.pattern.tramColours', 'logic.pattern.vehicleTypes', 'logic.pattern.colourUnits']) {
    it(`${id}: answer continues the unit`, () => {
      each(id, (q) => {
        if (id === 'logic.pattern.tramColours') return
        if (q.task.kind !== 'choice') throw new Error('choice expected')
        // id = base:shape:unit:miss ; rebuild the sequence and compare with the answer.
        const [, shape, unit, miss] = q.id.split(':')
        const syms = unit.split('-')
        const letters = [...new Set(shape)]
        const key = (c: string) => {
          const s = syms[letters.indexOf(c)]
          return s
        }
        // colour symbols contain a '-' (sprite-tint), so re-join pairs when needed.
        const parts = id.endsWith('colourUnits')
          ? Array.from({ length: syms.length / 2 }, (_, i) => `${syms[2 * i]}-${syms[2 * i + 1]}`)
          : syms
        const expected = id.endsWith('colourUnits')
          ? parts[letters.indexOf(shape[Number(miss) % shape.length])]
          : key(shape[Number(miss) % shape.length])
        expect(q.task.answer).toBe(expected)
      })
    })
  }
})

describe('order', () => {
  it('train lengths are sorted', () => {
    each('logic.order.trainLength', (q) => {
      if (q.task.kind !== 'order') throw new Error()
      const ns = q.task.answer.map((a) => Number(a.slice(1)))
      const up = [...ns].sort((a, b) => a - b)
      const down = [...up].reverse()
      expect(q.prompt.includes('Kortaste') ? up : down).toEqual(ns)
    })
  })
  it('tram stops follow the map', () => {
    each('logic.order.tramStops', (q) => {
      if (q.task.kind !== 'order') throw new Error()
      expect(q.id.endsWith(q.task.answer.join('>'))).toBe(true)
      expect(q.scene?.kind).toBe('group')
    })
  })
  it('carriage numbers are consecutive', () => {
    each('logic.order.carriageNumbers', (q, level) => {
      if (q.task.kind !== 'order') throw new Error()
      const ns = q.task.answer.map((a) => Number(a.slice(1)))
      expect(Math.abs(ns[0] - ns[ns.length - 1])).toBe(ns.length - 1)
      expect(q.task.answer.length).toBe(level <= 2 ? 3 : level <= 4 ? 4 : 5)
    })
  })
  it('route question answer is adjacent on the map', () => {
    each('logic.order.tramRoute', (q) => {
      if (q.task.kind !== 'choice') throw new Error()
      const [, mode, route, ref] = q.id.split(':')
      const stops = route.split('>')
      const i = stops.indexOf(ref)
      expect(q.task.answer).toBe(stops[mode === 'after' ? i + 1 : i - 1])
    })
  })
})

describe('category', () => {
  it('odd one out is the single different kind', () => {
    each('logic.category.oddOneOut', (q) => {
      if (q.task.kind !== 'choice') throw new Error()
      const kinds = q.task.choices.map((c) => c.id.split(':')[0])
      const odd = q.task.answer.split(':')[0]
      expect(kinds.filter((k) => k === odd)).toHaveLength(1)
      expect(new Set(kinds).size).toBe(2)
    })
  })
  it('railOrAir answers match the question', () => {
    each('logic.category.railOrAir', (q) => {
      if (q.task.kind !== 'choice') throw new Error()
      const rail = q.prompt.includes('spår')
      expect(isRail(q.task.answer as Kind)).toBe(rail)
      const others = q.task.choices.filter((c) => c.id !== q.task.answer)
      for (const c of others) expect(isRail(c.id as Kind)).toBe(!rail)
    })
  })
  it('nameTheKind shows the matching sprite', () => {
    each('logic.category.nameTheKind', (q) => {
      if (q.task.kind !== 'choice' || q.scene?.kind !== 'row') throw new Error()
      expect(q.scene.items[0].sprite).toBe(KIND_SPRITE[q.task.answer as Kind])
    })
  })
})
