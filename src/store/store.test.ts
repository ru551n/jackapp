import { describe, expect, it } from 'vitest'
import { isUnlocked, newlyUnlocked, nextUnlock, VEHICLES } from '../content/vehicles'
import { defaultState, loadState, saveState, STORAGE_KEY } from './state'
import { actions, getState } from './store'

describe('persistence', () => {
  it('round-trips state through storage', () => {
    const s = defaultState()
    s.missions.flygplatsen = 3
    s.settings.freePlayEnabled = true
    saveState(s)
    expect(loadState()).toEqual(s)
  })

  it('falls back to defaults on corrupt or foreign data', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    expect(loadState()).toEqual(defaultState())
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 99 }))
    expect(loadState()).toEqual(defaultState())
  })

  it('fills in fields added after the data was saved', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, settings: { sound: true } }))
    const s = loadState()
    expect(s.settings).toEqual({ ...defaultState().settings, sound: true })
    expect(s.missions).toEqual(defaultState().missions)
  })
})

describe('actions', () => {
  it('record answers per skill and persist', () => {
    actions._replace(defaultState())
    actions.recordAnswer('math.add', 'math.add:x', 0, 0)
    actions.recordAnswer('math.add', 'math.add:y', 2, 2)
    expect(getState().progress['math.add']).toMatchObject({ attempts: 2, firstTry: 1, hintsUsed: 2 })
    expect(getState().recentQuestionIds).toEqual(['math.add:x', 'math.add:y'])
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).progress['math.add'].attempts).toBe(2)
  })

  it('completing a session counts a mission and advances the seed', () => {
    actions._replace(defaultState())
    actions.completeSession({ at: 1, area: 'tunnelbanan', skills: ['math.count'], firstTry: 4, total: 4 })
    expect(getState().missions.tunnelbanan).toBe(1)
    expect(getState().sessionCounter).toBe(1)
    expect(getState().sessions).toHaveLength(1)
  })

  it('reset keeps settings and PIN', () => {
    actions._replace(defaultState())
    actions.updateSettings({ sound: true })
    actions.setParentPin('2468')
    actions.completeSession({ at: 1, area: 'stationen', skills: [], firstTry: 0, total: 4 })
    actions.resetProgress()
    expect(getState().missions.stationen).toBe(0)
    expect(getState().settings.sound).toBe(true)
    expect(getState().parentPin).toBe('2468')
  })
})

describe('unlocks', () => {
  it('are a pure, predictable function of missions', () => {
    const none = defaultState().missions
    expect(VEHICLES.some((v) => isUnlocked(v, none))).toBe(false)
    const v = VEHICLES[0]
    const after = { ...none, [v.unlock.area === 'any' ? 'stationen' : v.unlock.area]: v.unlock.missions }
    expect(newlyUnlocked(none, after).map((x) => x.id)).toContain(v.id)
  })

  it('nextUnlock reports remaining missions for the area', () => {
    const next = nextUnlock('flygplatsen', defaultState().missions)
    expect(next).not.toBeNull()
    expect(next!.remaining).toBeGreaterThan(0)
  })
})
