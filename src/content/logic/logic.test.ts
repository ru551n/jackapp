import { describe, expect, it } from 'vitest'
import { createRng } from '../../core/rng'
import type { Level, Question, Scene, SceneItem, Support } from '../../core/types'
import { SHORT_STOPS } from './order'
import { KIND_SPRITE, isRail, type Kind } from './category'
import { LOGIC_GENERATORS } from './index'

const LEVELS: Level[] = [1, 2, 3, 4, 5]
const SEEDS = Array.from({ length: 40 }, (_, i) => i * 31 + 3)

function each(genId: string, fn: (q: Question, level: Level) => void, support: Support = 'normal') {
  const gen = LOGIC_GENERATORS.find((g) => g.id === genId)!
  for (const level of LEVELS) {
    if (level < gen.levels[0] || level > gen.levels[1]) continue
    for (const seed of SEEDS) fn(gen.generate({ rng: createRng(seed), level, support }), level)
  }
}

const sceneItems = (s: Scene): SceneItem[] =>
  s.kind === 'row' ? s.items : s.kind === 'group' ? s.scenes.flatMap(sceneItems) : []

/** Flatten a pattern scene into item keys, with null at the gap (the '?' text). */
function scenePattern(scene: Scene, tramColours: boolean): (string | null)[] {
  const key = (it: SceneItem) => (tramColours ? it.tint! : `${it.sprite}${it.tint ? `-${it.tint}` : ''}`)
  if (scene.kind === 'row') return scene.items.map(key)
  if (scene.kind !== 'group') throw new Error('row or group expected')
  return scene.scenes.flatMap((s) => (s.kind === 'text' ? [null] : scenePattern(s, tramColours)))
}

/** The answer implied by the shown items: the shortest period that fits them all. */
function impliedAnswer(seq: (string | null)[], hasGap: boolean): string {
  const seen = hasGap ? seq : [...seq, null]
  const gap = seen.indexOf(null)
  for (let p = 1; p < seen.length; p++) {
    const byRes = new Map<number, string>()
    const ok = seen.every((k, i) => k === null || (byRes.get(i % p) ?? (byRes.set(i % p, k), k)) === k)
    if (ok && byRes.has(gap % p)) return byRes.get(gap % p)!
  }
  throw new Error('no period')
}

describe('patterns', () => {
  for (const id of ['logic.pattern.tramColours', 'logic.pattern.vehicleTypes', 'logic.pattern.colourUnits']) {
    for (const support of ['normal', 'extra'] as const) {
      it(`${id} (${support}): answer continues the shown pattern`, () => {
        each(
          id,
          (q) => {
            if (q.task.kind !== 'choice' || !q.scene) throw new Error('choice + scene expected')
            const seq = scenePattern(q.scene, id.endsWith('tramColours'))
            expect(q.task.answer).toBe(impliedAnswer(seq, seq.includes(null)))
            if (support === 'extra') {
              expect(q.task.choices).toHaveLength(2)
              expect(sceneItems(q.scene).every((it) => it.group !== undefined)).toBe(true)
            }
            expect(q.hints[0].scene).toBeDefined()
          },
          support,
        )
      })
    }
  }
})

describe('order', () => {
  it('train lengths are sorted', () => {
    each('logic.order.trainLength', (q) => {
      if (q.task.kind !== 'order') throw new Error()
      const ns = q.task.answer.map((a) => Number(a.slice(1)))
      const up = [...ns].sort((a, b) => a - b)
      const down = [...up].reverse()
      expect(q.prompt.includes('kortaste') ? up : down).toEqual(ns)
    })
  })
  it('tram stops follow the map', () => {
    each('logic.order.tramStops', (q) => {
      if (q.task.kind !== 'order') throw new Error()
      const shown = q.scene?.kind === 'group' ? q.scene.scenes.flatMap((s) => (s.kind === 'sign' ? [s.text] : [])) : []
      expect(q.task.answer).toEqual(shown)
      expect(q.prompt).toContain('från vänster till höger')
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
  it('extra support: one fewer item, first item named, short stops at L1-2', () => {
    for (const id of ['logic.order.trainLength', 'logic.order.tramStops', 'logic.order.carriageNumbers']) {
      each(
        id,
        (q, level) => {
          if (q.task.kind !== 'order') throw new Error()
          expect(q.task.answer.length).toBe((level <= 2 ? 3 : level <= 4 ? 4 : 5) - 1)
          if (id.endsWith('tramStops')) expect(q.prompt).toContain(q.task.answer[0])
          if (id.endsWith('trainLength')) expect(q.prompt).toMatch(/Det har /)
        },
        'extra',
      )
    }
    each(
      'logic.order.tramRoute',
      (q) => {
        if (q.task.kind !== 'choice') throw new Error()
        expect(q.task.choices).toHaveLength(2)
      },
      'extra',
    )
  })
  it('level 1-2 tram stops are short names', () => {
    for (const id of ['logic.order.tramStops', 'logic.order.tramRoute'])
      each(id, (q, level) => {
        if (level > 2) return
        const names =
          q.scene?.kind === 'group' ? q.scene.scenes.flatMap((s) => (s.kind === 'sign' ? [s.text] : [])) : []
        expect(names.length).toBeGreaterThan(0)
        for (const n of names) expect(SHORT_STOPS).toContain(n)
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
  it('extra support: fewer choices and rail-vs-air contrast, hint names the category', () => {
    each(
      'logic.category.oddOneOut',
      (q) => {
        if (q.task.kind !== 'choice') throw new Error()
        expect(q.task.choices).toHaveLength(3)
        const [kinds, odd] = [
          q.task.choices.map((c) => c.id.split(':')[0] as Kind),
          q.task.answer.split(':')[0] as Kind,
        ]
        expect(new Set(kinds.map(isRail)).size).toBe(2)
        expect(q.hints[0].text).toMatch(/spår|flyger/)
        expect(isRail(odd)).toBe(q.hints[0].text.includes('spår'))
      },
      'extra',
    )
    each(
      'logic.category.nameTheKind',
      (q) => {
        if (q.task.kind !== 'choice') throw new Error()
        expect(q.task.choices).toHaveLength(2)
        expect(new Set(q.task.choices.map((c) => isRail(c.id as Kind))).size).toBe(2)
      },
      'extra',
    )
    each(
      'logic.category.railOrAir',
      (q) => {
        if (q.task.kind !== 'choice') throw new Error()
        expect(q.task.choices).toHaveLength(2)
      },
      'extra',
    )
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
