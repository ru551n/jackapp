import { describe, expect, it } from 'vitest'
import { AIRCRAFT_ART } from '../../art/vehicles/aircraft'
import { createRng } from '../../core/rng'
import type { Level } from '../../core/types'
import { AIRCRAFT } from '../vehicles/aircraft'
import { isNear } from './common'
import { compareEngines, compareFirstFlight, compareLength, compareSize } from './compare'
import { AVIATION_GENERATORS } from './index'
import { recognizeName, recognizeShadow, recognizeSwedish } from './recognize'

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
  it('has the twelve ids; fighters unlock via Flygplatsen, airliners via Engelska, in order', () => {
    expect(AIRCRAFT.map((v) => v.id)).toEqual(ORDER)
    for (const [area, category] of [
      ['flygplatsen', 'fighter'],
      ['engelska', 'airliner'],
    ] as const) {
      const track = AIRCRAFT.filter((v) => v.category === category)
      track.forEach((v, i) => expect(v.unlock, v.id).toEqual({ area, missions: i + 1 }))
    }
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
  it('engine questions only use airliners, whose engines are visibly countable', () => {
    for (const level of [2, 3, 4] as Level[])
      for (const q of run(compareEngines, level))
        for (const c of choiceOf(q).choices) expect(byId(c.id).category).toBe('airliner')
  })
  it('has a level-1 comparison: the airliner is bigger than the fighter, drawn to scale', () => {
    expect(AVIATION_GENERATORS.some((g) => g.skill === 'air.compare' && g.levels[0] === 1)).toBe(true)
    for (const q of run(compareSize, 1)) {
      const t = choiceOf(q)
      const len = (id: string) => byId(id).specs.lengthM!
      const scale = (id: string) => {
        const v = t.choices.find((c) => c.id === id)!.visual
        return v?.kind === 'vehicle' ? v.scale! : NaN
      }
      const [a, b] = t.choices.map((c) => c.id)
      expect(len(a) > len(b)).toBe(scale(a) > scale(b))
      const bigger = len(a) > len(b) ? a : b
      expect(t.answer).toBe(q.prompt.endsWith('störst?') ? bigger : t.choices.find((c) => c.id !== bigger)!.id)
    }
  })
  it('never offers look-alike silhouettes together', () => {
    for (const gen of [recognizeName, recognizeShadow])
      for (const level of [3, 4, 5] as Level[])
        for (const q of run(gen, level)) {
          const t = choiceOf(q)
          if (!t.choices.some((c) => c.visual?.kind === 'vehicle' && c.visual.view === 'silhouette')) continue
          for (const a of t.choices) for (const b of t.choices) if (a !== b) expect(isNear(a.id, b.id)).toBe(false)
        }
  })
  it('hints scaffold from the first miss and never claim to remove the only wrong choice', () => {
    for (const gen of AVIATION_GENERATORS)
      for (let level = gen.levels[0]; level <= gen.levels[1]; level++)
        for (const s of seeds.slice(0, 20)) {
          const q = gen.generate({ rng: createRng(s), level: level as Level, support: 'normal' })
          if (q.task.kind !== 'choice') continue
          expect(q.hints.length, gen.id).toBeGreaterThanOrEqual(2)
          if (q.task.choices.length === 2) for (const h of q.hints) expect(h.eliminate ?? [], gen.id).toEqual([])
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
