import { describe, expect, it } from 'vitest'
import { createRng } from '../core/rng'
import type { Generator, Outcome, SkillProgress } from '../core/types'
import { defaultState } from '../store/state'
import { applyOutcome, newSkillProgress, outcomeFromMisses, supportFor, trendOf } from './adaptation'
import { generatorsFor, nextQuestion, planSession, SESSION_LENGTH } from './session'

const feed = (p: SkillProgress, outcomes: Outcome[]) => outcomes.reduce((acc, o) => applyOutcome(acc, o, 0, 1), p)

describe('adaptation', () => {
  it('classifies misses', () => {
    expect([0, 1, 2, 5].map((m) => outcomeFromMisses(m))).toEqual(['first', 'retry', 'helped', 'helped'])
    // With only 2 options a single miss already means the child needed the remaining option.
    expect(outcomeFromMisses(1, 2)).toBe('helped')
  })

  it('levels down when 3 of the last 4 answers needed retries (reachable with 2 options)', () => {
    expect(feed(newSkillProgress(3), ['retry', 'first', 'retry', 'retry']).level).toBe(2)
  })

  it('levels up one step after four first-try answers in a row', () => {
    const p = feed(newSkillProgress(), ['first', 'first', 'first'])
    expect(p.level).toBe(1)
    const up = applyOutcome(p, 'first', 0, 1)
    expect(up.level).toBe(2)
    expect(up.recent).toEqual([])
  })

  it('a retry breaks the streak', () => {
    expect(feed(newSkillProgress(), ['first', 'first', 'retry', 'first', 'first']).level).toBe(1)
  })

  it('levels down after two strongly helped answers among the last three', () => {
    const p = feed(newSkillProgress(3), ['helped', 'first', 'helped'])
    expect(p.level).toBe(2)
  })

  it('never goes below 1 or above 5', () => {
    expect(feed(newSkillProgress(1), ['helped', 'helped', 'helped']).level).toBe(1)
    expect(feed(newSkillProgress(5), Array(8).fill('first')).level).toBe(5)
  })

  it('respects a parent lock', () => {
    const locked = { ...newSkillProgress(2), levelLocked: true }
    expect(feed(locked, Array(6).fill('first')).level).toBe(2)
    expect(feed(locked, Array(6).fill('first')).attempts).toBe(6)
  })

  it('counts attempts, first tries and hints', () => {
    const p = applyOutcome(applyOutcome(newSkillProgress(), 'first', 0, 1), 'helped', 2, 1)
    expect(p).toMatchObject({ attempts: 2, firstTry: 1, hintsUsed: 2 })
  })

  it('gives extra support after a hard answer', () => {
    expect(supportFor(undefined)).toBe('normal')
    expect(supportFor(feed(newSkillProgress(), ['first', 'helped']))).toBe('extra')
    expect(supportFor(feed(newSkillProgress(), ['retry', 'first', 'retry']))).toBe('extra')
    expect(supportFor(feed(newSkillProgress(), ['retry', 'first', 'first']))).toBe('normal')
  })

  it('summarises trend for parents', () => {
    expect(trendOf(undefined)).toBe('new')
    expect(trendOf(feed(newSkillProgress(), ['first', 'first']))).toBe('new') // too little data
    expect(trendOf(feed(newSkillProgress(), ['first', 'first', 'first']))).toBe('easy')
    expect(trendOf(feed(newSkillProgress(), ['helped', 'retry', 'first']))).toBe('hard')
  })
})

describe('session planning', () => {
  it('practises never-tried skills first, two skills per session', () => {
    const plan = planSession('tunnelbanan', defaultState(), ['math.count', 'math.add', 'math.sub'])
    expect(plan).toHaveLength(SESSION_LENGTH)
    expect(plan).toEqual(['math.count', 'math.count', 'math.add', 'math.add'])
  })

  it('rotates to the least recently practised skills', () => {
    const s = defaultState()
    s.progress['math.count'] = { ...newSkillProgress(), lastPracticed: 100 }
    s.progress['math.add'] = { ...newSkillProgress(), lastPracticed: 50 }
    s.progress['math.sub'] = { ...newSkillProgress(), lastPracticed: 200 }
    expect(planSession('tunnelbanan', s, ['math.count', 'math.add', 'math.sub'])).toEqual([
      'math.add',
      'math.add',
      'math.count',
      'math.count',
    ])
  })

  it('uses a single skill when only one is available', () => {
    expect(new Set(planSession('stationen', defaultState(), ['read.words']))).toEqual(new Set(['read.words']))
  })
})

describe('question selection', () => {
  const gen = (id: string, levels: [1 | 2 | 3 | 4 | 5, 1 | 2 | 3 | 4 | 5]): Generator => ({
    id,
    skill: 'math.count',
    levels,
    generate: ({ rng, level, support }) => ({
      id: `math.count.${id}:${rng.int(1, 3)}`,
      skill: 'math.count',
      level,
      theme: 'metro',
      prompt: support,
      task: {
        kind: 'choice',
        choices: [
          { id: 'a', label: 'a' },
          { id: 'b', label: 'b' },
        ],
        answer: 'a',
      },
      hints: [{ text: 'h' }],
    }),
  })

  it('selects generators for the level, else the closest', () => {
    const all = [gen('low', [1, 2]), gen('high', [4, 5])]
    expect(generatorsFor(all, 'math.count', 1).map((g) => g.id)).toEqual(['low'])
    expect(generatorsFor(all, 'math.count', 3).map((g) => g.id)).toEqual(['low', 'high'])
  })

  it('is deterministic and avoids recent questions', () => {
    const all = [gen('g', [1, 5])]
    const s = defaultState()
    const a = nextQuestion(all, 'math.count', s, 99, [])
    expect(nextQuestion(all, 'math.count', s, 99, []).id).toBe(a.id)
    expect(nextQuestion(all, 'math.count', s, 99, [a.id]).id).not.toBe(a.id)
  })

  it('passes extra support after a hard answer', () => {
    const s = defaultState()
    s.progress['math.count'] = feed(newSkillProgress(), ['helped'])
    expect(nextQuestion([gen('g', [1, 5])], 'math.count', s, 1, []).prompt).toBe('extra')
  })
})

describe('rng', () => {
  it('is reproducible and in range', () => {
    const a = createRng(7)
    const b = createRng(7)
    const xs = Array.from({ length: 50 }, () => a.int(2, 5))
    expect(xs).toEqual(Array.from({ length: 50 }, () => b.int(2, 5)))
    expect(Math.min(...xs)).toBe(2)
    expect(Math.max(...xs)).toBe(5)
  })
})
