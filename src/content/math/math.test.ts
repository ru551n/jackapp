import { describe, expect, it } from 'vitest'
import { createRng } from '../../core/rng'
import type { Level, Scene, SceneItem } from '../../core/types'
import { MATH_GENERATORS } from './index'
import { MAX_BY_LEVEL, MIN_BY_LEVEL } from './kit'

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

const countRows = (s?: Scene) => rowsOf(s).flat().length

describe('addition and subtraction', () => {
  for (const op of ['add', 'sub'] as const) {
    it(`math.${op}: answer, range, pictures and hints`, () => {
      for (const { q, level, support } of questions(`math.${op}.`)) {
        const m = q.id.match(/:(\d+)([+−])(\d+):([a-z-]+)$/)!
        const a = Number(m[1])
        const b = Number(m[3])
        const form = m[4]
        const answer = op === 'add' ? a + b : a - b
        const top = op === 'add' ? answer : a
        const choices = q.task.kind === 'choice' ? q.task.choices : []
        expect(q.task.kind === 'choice' && q.task.answer, q.id).toBe(String(answer))
        // same numeric range with and without extra support
        expect(top, q.id).toBeLessThanOrEqual(MAX_BY_LEVEL[level])
        expect(top, q.id).toBeGreaterThanOrEqual(level + 2)
        expect(a, q.id).toBeGreaterThanOrEqual(2)
        expect(answer, q.id).toBeGreaterThanOrEqual(2)
        // pictures at L1-L4 and with extra support; L5 normal keeps only a count-on aid
        const full = countRows(q.scene) === top
        if (level <= 4 || support === 'extra') expect(full, q.id).toBe(true)
        else {
          expect(form, q.id).toBe('eq-aid')
          expect(countRows(q.scene), q.id).toBe(b)
        }
        if (level >= 3) expect(hasEquation(q.scene), q.id).toBe(true)
        if (op === 'sub' && full)
          expect(
            rowsOf(q.scene)
              .flat()
              .filter((i) => i.state === 'leaving').length,
            q.id,
          ).toBe(b)
        // first miss must scaffold: a picture and a counting cue, never an elimination with 2 choices
        expect(q.hints[0].scene, q.id).toBeDefined()
        expect(q.hints[0].eliminate, q.id).toBeUndefined()
        expect(q.hints[0].text, q.id).toMatch(/Börja på \d+ och räkna/)
        if (choices.length <= 2) expect(q.hints[1].eliminate, q.id).toBeUndefined()
        expect(q.prompt, q.id).not.toContain('Hur mycket är')
      }
    })
  }
  it('range grows with level and ids name the shown form', () => {
    for (const level of [1, 2, 3, 4, 5] as const) {
      const ids = new Set<string>()
      for (const { q, level: l } of questions('math.add.carriages')) if (l === level) ids.add(q.id.split(':')[2])
      expect(ids.size).toBeGreaterThan(0)
    }
  })
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

describe('shared range', () => {
  it('count/oneMoreLess/compare stay in range and never start trivially', () => {
    for (const { q, level, gen } of questions('math.')) {
      if (gen.id.startsWith('math.add') || gen.id.startsWith('math.sub') || gen.id.startsWith('math.sequence')) continue
      const rows = rowsOf(q.scene).flat().length
      expect(rows, q.id).toBeLessThanOrEqual(MAX_BY_LEVEL[level])
      const start = q.id.match(/:(\d+)(?:->|v|$)/)
      if (start && !gen.id.includes('compare'))
        expect(Number(start[1]), q.id).toBeGreaterThanOrEqual(MIN_BY_LEVEL[level])
      expect(q.prompt, q.id).not.toMatch(/plattan|plattform|ställ dem|färre resen/i)
      expect(JSON.stringify(q), q.id).not.toMatch(/(med|har) (1|en) vagn\b.*tunnelbanetåg|tunnelbanetåg med 1 vagn/)
    }
  })
  it('compare keeps a gap of 2 at L1-2', () => {
    for (const { q, level } of questions('math.compare.')) {
      const m = q.id.match(/:(\d+)v(\d+):/)!
      if (level <= 2) expect(Math.abs(Number(m[1]) - Number(m[2])), q.id).toBeGreaterThanOrEqual(2)
    }
  })
})
