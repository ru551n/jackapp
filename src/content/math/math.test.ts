import { describe, expect, it } from 'vitest'
import { createRng } from '../../core/rng'
import type { Level, Scene, SceneItem } from '../../core/types'
import { MATH_GENERATORS } from './index'

const SEEDS = Array.from({ length: 60 }, (_, i) => i * 104729 + 3)

const rowsOf = (s?: Scene): SceneItem[][] =>
  !s ? [] : s.kind === 'row' ? [s.items] : s.kind === 'group' ? s.scenes.flatMap(rowsOf) : []
const hasEquation = (s?: Scene): boolean =>
  !s ? false : s.kind === 'equation' || (s.kind === 'group' && s.scenes.some(hasEquation))

function* questions(prefix: string) {
  for (const gen of MATH_GENERATORS.filter((g) => g.id.startsWith(prefix)))
    for (let level = gen.levels[0]; level <= gen.levels[1]; level++)
      for (const support of ['normal', 'extra'] as const)
        for (const seed of SEEDS)
          yield {
            gen,
            level: level as Level,
            support,
            q: gen.generate({ rng: createRng(seed), level: level as Level, support }),
          }
}

describe('addition and subtraction', () => {
  for (const op of ['add', 'sub'] as const) {
    it(`math.${op}: answer matches the depicted quantities`, () => {
      for (const { q, level, support } of questions(`math.${op}.`)) {
        const m = q.id.match(/:(\d+)([+−])(\d+):L(\d)$/)!
        const a = Number(m[1])
        const b = Number(m[3])
        const answer = op === 'add' ? a + b : a - b
        expect(q.task.kind === 'choice' && q.task.answer, q.id).toBe(String(answer))
        expect(answer, q.id).toBeGreaterThanOrEqual(1)
        const rows = rowsOf(q.scene).flat()
        if (rows.length) {
          const leaving = rows.filter((i) => i.state === 'leaving').length
          if (op === 'add') expect(rows.length, q.id).toBe(a + b)
          else {
            expect(rows.length, q.id).toBe(a)
            expect(leaving, q.id).toBe(b)
          }
        }
        // picture-first levels always show pictures; symbolic L5 only without extra support
        if (level <= 3 || support === 'extra') expect(rows.length, q.id).toBeGreaterThan(0)
        if (level === 5 && support === 'normal') expect(rows.length, q.id).toBe(0)
        if (level >= 3) expect(hasEquation(q.scene), q.id).toBe(true)
        if (level <= 2) expect(a + b <= 6 || op === 'sub', q.id).toBe(true)
      }
    })
  }
})

describe('one more / one less', () => {
  it('answer is start +/- 1', () => {
    for (const { q, gen } of questions('math.oneMoreLess.')) {
      const m = q.id.match(/:(\d+)->(\d+)$/)!
      expect(Number(m[2]) - Number(m[1]), q.id).toBe(gen.id.endsWith('more') ? 1 : -1)
      expect(q.task.kind === 'choice' && q.task.answer, q.id).toBe(m[2])
    }
  })
})

describe('sequence', () => {
  it('hidden number continues the sequence', () => {
    for (const { q } of questions('math.sequence.')) {
      const nums = q.id.split(':')[1].split(',')
      const h = nums.indexOf('_')
      const known = nums.map(Number)
      const answer = q.task.kind === 'choice' ? Number(q.task.answer) : NaN
      // the first number is always visible, so the hole is interior or last
      expect(h, q.id).toBeGreaterThan(0)
      const step = h === 1 ? (known[2] - known[0]) / 2 : known[1] - known[0]
      expect(answer, q.id).toBe(known[0] + h * step)
    }
  })
})

describe('counting and comparing', () => {
  it('count answer equals the number of items', () => {
    for (const { q, gen } of questions('math.count.'))
      if (!gen.id.endsWith('numberToTrain'))
        expect(rowsOf(q.scene).flat().length, q.id).toBe(Number(q.task.kind === 'choice' && q.task.answer))
  })
  it('compare answer is the longest/shortest row', () => {
    for (const { q } of questions('math.compare.')) {
      const m = q.id.match(/:(\d+)v(\d+):(most|least)$/)!
      const [x, y] = [Number(m[1]), Number(m[2])]
      const want = (m[3] === 'most' ? x > y : x < y) ? '1' : '2'
      expect(q.task.kind === 'choice' && q.task.answer, q.id).toBe(want)
    }
  })
})
