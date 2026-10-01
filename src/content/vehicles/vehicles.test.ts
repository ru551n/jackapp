import { describe, expect, it } from 'vitest'
import { AREAS } from '../../core/catalog'
import type { AppState, AreaId } from '../../core/types'
import { defaultState } from '../../store/state'
import { GENERATORS } from '../index'
import { isUnlocked, newlyUnlocked, nextUnlock, VEHICLES } from './index'

type Missions = AppState['missions']
const withMissions = (area: AreaId | 'any', n: number): Missions => {
  const m = defaultState().missions
  if (area === 'any')
    m.stationen = n // the 'any' rule sums all areas
  else m[area] = n
  return m
}
const ALL = Object.fromEntries(AREAS.map((a) => [a.id, 999])) as Missions

describe('vehicle unlock rules', () => {
  for (const v of VEHICLES) {
    it(`${v.id} is locked at missions-1 and unlocked at missions`, () => {
      expect(isUnlocked(v, withMissions(v.unlock.area, v.unlock.missions - 1))).toBe(false)
      expect(isUnlocked(v, withMissions(v.unlock.area, v.unlock.missions))).toBe(true)
    })
  }

  it('nextUnlock is null when everything is unlocked', () => {
    for (const a of AREAS) expect(nextUnlock(a.id, ALL)).toBeNull()
  })

  it('nextUnlock picks the smallest remaining among area and "any" rules', () => {
    for (const a of AREAS) {
      const m = defaultState().missions
      const expected = Math.min(
        ...VEHICLES.filter((v) => v.unlock.area === a.id || v.unlock.area === 'any').map((v) => v.unlock.missions),
      )
      expect(nextUnlock(a.id, m)!.remaining).toBe(expected)
    }
  })

  it('newlyUnlocked does not re-report already unlocked vehicles', () => {
    const before = withMissions('flygplatsen', 1)
    expect(newlyUnlocked(before, before)).toEqual([])
    const after = withMissions('flygplatsen', 2)
    const ids = newlyUnlocked(before, after).map((v) => v.id)
    expect(ids).toContain('viggen')
    expect(ids).not.toContain('gripen')
  })
})

describe('skill catalog', () => {
  const catalogSkills = AREAS.flatMap((a) => a.skills)

  it('puts every skill in exactly one area', () => {
    expect(new Set(catalogSkills).size).toBe(catalogSkills.length)
  })

  it('has every generator skill in the catalog', () => {
    for (const g of GENERATORS) expect(catalogSkills, g.id).toContain(g.skill)
  })
})
