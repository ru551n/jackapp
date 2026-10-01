import { describe, expect, it } from 'vitest'
import { isUnlocked, newlyUnlocked, nextUnlock, VEHICLES } from '../content/vehicles'
import { defaultState, LEGACY_KEY, learnerKey, loadState, saveState } from './state'
import { actions, getState, selectLearner } from './store'

describe('persistence', () => {
  it('round-trips state through storage', () => {
    const s = defaultState()
    s.missions.flygplatsen = 3
    s.settings.freePlayEnabled = true
    s.parentPin = '2468'
    s.freePlay.line = { vehicle: 'tram', stations: [{ id: 'a', name: 'Bron', x: 10, y: 20 }] }
    saveState(s, learnerKey('a'))
    expect(loadState(localStorage, learnerKey('a'))).toEqual(s)
  })

  it('falls back to defaults on corrupt or foreign data', () => {
    localStorage.setItem(LEGACY_KEY, '{not json')
    expect(loadState()).toEqual(defaultState())
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ version: 99 }))
    expect(loadState()).toEqual(defaultState())
  })

  it('survives wrongly shaped fields without crashing', () => {
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify({
        version: 1,
        progress: null,
        sessions: 'x',
        recentQuestionIds: 5,
        missions: { stationen: -3, tunnelbanan: 'many', flygplatsen: 2.7 },
        parentPin: 1234,
        freePlay: { line: 'oops' },
      }),
    )
    const s = loadState()
    expect(s.progress).toEqual({})
    expect(s.sessions).toEqual([])
    expect(s.recentQuestionIds).toEqual([])
    expect(s.missions).toEqual({ ...defaultState().missions, flygplatsen: 2 })
    expect(s.parentPin).toBeUndefined()
    expect(s.freePlay.line).toBeNull()
  })

  it('survives storage that throws on read', () => {
    expect(
      loadState({
        getItem: () => {
          throw new Error('SecurityError')
        },
      }),
    ).toEqual(defaultState())
  })

  it('fills in fields added after the data was saved', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ version: 1, settings: { sound: true } }))
    const s = loadState()
    expect(s.settings).toEqual({ ...defaultState().settings, sound: true })
    expect(s.missions).toEqual(defaultState().missions)
  })
})

describe('actions', () => {
  it('record answers per skill and persist under the learner key', () => {
    selectLearner('a')
    actions._replace(defaultState())
    actions.recordAnswer('math.add', 'math.add:x', 0, 0)
    actions.recordAnswer('math.add', 'math.add:y', 2, 2)
    expect(getState().progress['math.add']).toMatchObject({ attempts: 2, firstTry: 1, hintsUsed: 2 })
    expect(getState().recentQuestionIds).toEqual(['math.add:x', 'math.add:y'])
    expect(JSON.parse(localStorage.getItem(learnerKey('a'))!).progress['math.add'].attempts).toBe(2)
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
    selectLearner(undefined)
  })

  it('keeps each learner separate and never persists without a learner', () => {
    selectLearner(undefined)
    actions.addMission('stationen')
    expect(localStorage.length).toBe(0)
    selectLearner('a')
    actions.addMission('tunnelbanan')
    selectLearner('b')
    expect(getState().missions.tunnelbanan).toBe(0)
    selectLearner('a')
    expect(getState().missions.tunnelbanan).toBe(1)
    selectLearner(undefined)
  })

  it('tracks English separately from Swedish reading', () => {
    actions._replace(defaultState())
    for (let i = 0; i < 4; i++) actions.recordAnswer('en.words', `en.words:${i}`, 0, 0)
    expect(getState().progress['en.words']?.level).toBe(2)
    expect(getState().progress['read.words']).toBeUndefined()
    actions.completeSession({ at: 1, area: 'engelska', skills: ['en.words'], firstTry: 4, total: 4 })
    expect(getState().missions).toMatchObject({ engelska: 1, stationen: 0 })
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

describe('caps', () => {
  it('keeps only the last 50 sessions', () => {
    actions._replace(defaultState())
    for (let i = 0; i < 55; i++)
      actions.completeSession({ at: i, area: 'stationen', skills: [], firstTry: 0, total: 4 })
    expect(getState().sessions).toHaveLength(50)
    expect(getState().sessions[0].at).toBe(5)
    expect(getState().missions.stationen).toBe(55)
  })

  it('keeps only the last 40 recent question ids', () => {
    actions._replace(defaultState())
    for (let i = 0; i < 45; i++) actions.recordAnswer('math.add', `math.add:${i}`, 0, 0)
    expect(getState().recentQuestionIds).toHaveLength(40)
    expect(getState().recentQuestionIds[0]).toBe('math.add:5')
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
