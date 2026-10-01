import { describe, expect, it } from 'vitest'
import { defaultState, LEGACY_KEY, learnerKey } from './state'
import { claimLegacy, declineLegacy, legacyClaimedBy, legacyOffer } from './legacy'
import { actions, getState, selectLearner } from './store'

const legacy = () => {
  const s = defaultState()
  s.missions.flygplatsen = 3
  s.parentPin = '2468'
  s.settings.sound = true
  return JSON.stringify(s)
}

describe('legacy migration', () => {
  it('offers nothing without legacy data, or with empty or corrupt data', () => {
    expect(legacyOffer('a')).toBeNull()
    localStorage.setItem(LEGACY_KEY, '{not json')
    expect(legacyOffer('a')).toBeNull()
    localStorage.setItem(LEGACY_KEY, JSON.stringify(defaultState()))
    expect(legacyOffer('a')).toBeNull()
    expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull()
  })

  it('is adopted once by the first learner who accepts, and the legacy key is kept', () => {
    const raw = legacy()
    localStorage.setItem(LEGACY_KEY, raw)
    selectLearner('a')
    actions.updateSettings({ sound: false, speech: false })
    const offer = legacyOffer('a')!
    expect(offer.missions.flygplatsen).toBe(3)
    actions.adoptLegacy(offer)
    claimLegacy('a')

    expect(getState().missions.flygplatsen).toBe(3)
    expect(getState().settings).toMatchObject({ sound: false, speech: false })
    expect(getState().parentPin).toBeUndefined()
    expect(JSON.parse(localStorage.getItem(learnerKey('a'))!).missions.flygplatsen).toBe(3)
    // Never deleted or changed: an adult imports it to the server later.
    expect(localStorage.getItem(LEGACY_KEY)).toBe(raw)
    expect(legacyClaimedBy()).toBe('a')
    expect(legacyOffer('a')).toBeNull()
    expect(legacyOffer('b')).toBeNull()
    selectLearner(undefined)
  })

  it('a declined learner is not asked again, but another learner may still be', () => {
    localStorage.setItem(LEGACY_KEY, legacy())
    declineLegacy('a')
    expect(legacyOffer('a')).toBeNull()
    expect(legacyOffer('b')).not.toBeNull()
    expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull()
  })
})
