import { describe, expect, it } from 'vitest'
import { AIRCRAFT_ART } from '../../art/vehicles/aircraft'
import { createRng } from '../../core/rng'
import type { Level } from '../../core/types'
import { AIRCRAFT } from '../vehicles/aircraft'
import { compareEngines, compareFirstFlight, compareLength } from './compare'
import { recognizeSwedish } from './recognize'

const ORDER = [
  'gripen',
  'a320',
  'viggen',
  'f16',
  'draken',
  'b737',
  'rafale',
  'saab340',
  'typhoon',
  'fa18',
  'a380',
  'f15',
]
const byId = (id: string) => AIRCRAFT.find((v) => v.id === id)!
const seeds = Array.from({ length: 60 }, (_, i) => i + 1)

describe('aircraft', () => {
  it('has the twelve ids in the fixed unlock order', () => {
    expect(AIRCRAFT.map((v) => v.id)).toEqual(ORDER)
    AIRCRAFT.forEach((v, i) => expect(v.unlock).toEqual({ area: 'flygplatsen', missions: i + 1 }))
  })
  it('has art for every aircraft', () => {
    for (const v of AIRCRAFT) expect(AIRCRAFT_ART[v.id], v.id).toBeDefined()
  })
})

describe('aviation answers', () => {
  const run = (gen: typeof compareLength, level: Level) =>
    seeds.map((s) => gen.generate({ rng: createRng(s), level, support: 'normal' }))
  const choiceOf = (q: ReturnType<typeof compareLength.generate>) => {
    if (q.task.kind !== 'choice') throw new Error('choice expected')
    return q.task
  }

  it('Sweden answers are Swedish', () => {
    for (const q of run(recognizeSwedish, 3)) expect(byId(choiceOf(q).answer).swedish).toBe(true)
  })
  it('engine answers match the specs', () => {
    for (const q of run(compareEngines, 3)) {
      const n = { en: 1, två: 2, fyra: 4 }[q.prompt.split(' ')[3] as 'en' | 'två' | 'fyra']
      const t = choiceOf(q)
      expect(byId(t.answer).specs.engines).toBe(n)
      for (const c of t.choices.filter((c) => c.id !== t.answer)) expect(byId(c.id).specs.engines).not.toBe(n)
    }
  })
  it('length answers are longest or shortest', () => {
    for (const level of [3, 5] as Level[])
      for (const q of run(compareLength, level)) {
        const t = choiceOf(q)
        const lens = t.choices.map((c) => byId(c.id).specs.lengthM!)
        const a = byId(t.answer).specs.lengthM!
        expect(a).toBe(q.prompt.endsWith('kortast?') ? Math.min(...lens) : Math.max(...lens))
      }
  })
  it('first-flight answer is the earliest year', () => {
    for (const q of run(compareFirstFlight, 5)) {
      const t = choiceOf(q)
      const years = t.choices.map((c) => byId(c.id).specs.firstYear!)
      expect(byId(t.answer).specs.firstYear).toBe(Math.min(...years))
      expect(new Set(years).size).toBe(years.length)
    }
  })
})
