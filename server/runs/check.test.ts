import { describe, expect, it } from 'vitest'
import { Item } from '../../shared/contracts'
import { checkAnswer, normalizeText, parseNumber, publicItem, solutionText } from './check'

const base = { prompt: 'Fråga', difficulty: 2, skills: ['s'], sources: [{ kind: 'model', capability: 'text' }] }
const item = (x: Record<string, unknown>) => Item.parse({ id: 'i', ...base, ...x })
const score = (i: Item, a: unknown) => checkAnswer(i, a).score

const choices = [
  { id: 'a', text: 'A' },
  { id: 'b', text: 'B' },
  { id: 'c', text: 'C' },
  { id: 'd', text: 'D' },
]

describe('checkers', () => {
  it('multiple choice and true/false', () => {
    const mc = item({ kind: 'multipleChoice', choices, answer: 'b' })
    expect(checkAnswer(mc, 'b')).toEqual({ score: 1, correct: true })
    expect(checkAnswer(mc, 'a')).toEqual({ score: 0, correct: false })
    const tf = item({ kind: 'trueFalse', answer: false })
    expect(score(tf, false)).toBe(1)
    expect(score(tf, true)).toBe(0)
  })

  it('multi-select gives partial credit and subtracts wrong picks', () => {
    const ms = item({ kind: 'multiSelect', choices, answers: ['a', 'c'] })
    expect(checkAnswer(ms, ['c', 'a'])).toEqual({ score: 1, correct: true })
    expect(score(ms, ['a'])).toBe(0.5)
    expect(score(ms, ['a', 'b'])).toBe(0)
    expect(score(ms, ['a', 'b', 'd'])).toBe(0) // never negative
    expect(score(ms, ['a', 'b', 'c', 'd'])).toBe(0)
  })

  it('ordering is all or nothing', () => {
    const o = item({ kind: 'ordering', items: choices.slice(0, 3), answer: ['c', 'a', 'b'] })
    expect(score(o, ['c', 'a', 'b'])).toBe(1)
    expect(score(o, ['a', 'c', 'b'])).toBe(0)
    expect(score(o, ['c', 'a'])).toBe(0)
  })

  it('matching gives per-pair credit', () => {
    const m = item({
      kind: 'matching',
      pairs: [
        { left: 'hund', right: 'dog' },
        { left: 'katt', right: 'cat' },
        { left: 'häst', right: 'horse' },
        { left: 'ko', right: 'cow' },
      ],
    })
    expect(score(m, ['dog', 'cat', 'horse', 'cow'])).toBe(1)
    expect(score(m, ['dog', 'cow', 'horse', 'cat'])).toBe(0.5)
    expect(score(m, [])).toBe(0)
  })

  it('fill-in-the-blank: variants, case/space/diacritics tolerant, but å/ä/ö are distinct', () => {
    const f = item({
      kind: 'fillBlank',
      text: '___ bor ___.',
      blanks: [{ accepted: ['Hon', 'hen'] }, { accepted: ['här', 'där'] }],
    })
    expect(score(f, ['  HON ', 'här.'])).toBe(1)
    expect(score(f, ['hen', 'Där'])).toBe(1)
    expect(score(f, ['hon', 'har'])).toBe(0.5) // ä ≠ a
    expect(score(f, ['hon'])).toBe(0.5)
    expect(normalizeText('Café  au   lait!')).toBe('cafe au lait')
    expect(normalizeText('Åsa Öberg')).toBe('åsa öberg')
    expect(normalizeText('Åsa')).not.toBe(normalizeText('Asa'))
    expect(normalizeText('köra')).not.toBe(normalizeText('kora'))
  })

  it('numeric: comma decimals, fractions, units and tolerance', () => {
    expect(parseNumber('3,5')).toBe(3.5)
    expect(parseNumber('3.5')).toBe(3.5)
    expect(parseNumber('3/4')).toBe(0.75)
    expect(parseNumber('1 1/2')).toBe(1.5)
    expect(parseNumber('-1 1/2')).toBe(-1.5)
    expect(parseNumber('½')).toBe(0.5)
    expect(parseNumber('1 000')).toBe(1000)
    expect(parseNumber('−4')).toBe(-4)
    expect(parseNumber('12 cm', 'cm')).toBe(12)
    expect(parseNumber('12cm', 'CM')).toBe(12)
    expect(parseNumber('12 m', 'cm')).toBeUndefined()
    expect(parseNumber('12 äpplen')).toBeUndefined()
    expect(parseNumber('1/0')).toBeUndefined()
    expect(parseNumber('tolv')).toBeUndefined()
    expect(parseNumber('')).toBeUndefined()

    const n = item({ kind: 'numeric', answer: 2.5, unit: 'kg' })
    expect(score(n, '2,5 kg')).toBe(1)
    expect(score(n, '5/2')).toBe(1)
    expect(score(n, 2.5)).toBe(1)
    expect(score(n, '2,6')).toBe(0)
    expect(score(n, '2,5 g')).toBe(0)
    const t = item({ kind: 'numeric', answer: 3.14, tolerance: 0.01 })
    expect(score(t, '3,15')).toBe(1)
    expect(score(t, '3,16')).toBe(0)
    expect(score(item({ kind: 'numeric', answer: 0.3 }), '0,1+0,2')).toBe(0)
    expect(score(item({ kind: 'numeric', answer: 0.1 + 0.2 }), '0,3')).toBe(1) // float noise
  })

  it('flashcards and free text are self-rated', () => {
    const fc = item({ kind: 'flashcard', back: 'baksida' })
    expect(checkAnswer(fc, 'knew')).toEqual({ score: 1, correct: true })
    expect(checkAnswer(fc, 'partly')).toEqual({ score: 0.5, correct: false })
    expect(score(fc, 'notYet')).toBe(0)
    const ft = item({ kind: 'freeText', rubric: ['punkt'] })
    expect(score(ft, { text: 'svar', selfRating: 'partly' })).toBe(0.5)
    expect(() => checkAnswer(ft, { text: 'svar' })).toThrow()
  })
})

describe('display', () => {
  it('public items carry no answers and never present the solved order', () => {
    const items = [
      item({ kind: 'multipleChoice', choices, answer: 'b', hints: ['h'], explanation: 'e' }),
      item({ kind: 'multiSelect', choices, answers: ['a'] }),
      item({ kind: 'trueFalse', answer: true }),
      item({ kind: 'fillBlank', text: '___', blanks: [{ accepted: ['x'] }] }),
      item({ kind: 'numeric', answer: 7, tolerance: 0, check: '3+4', unit: 'st' }),
      item({ kind: 'freeText', rubric: ['r'], sampleAnswer: 'sample' }),
    ]
    for (const i of items) {
      const p = publicItem(i, 'seed')
      for (const k of [
        'answer',
        'answers',
        'blanks',
        'rubric',
        'sampleAnswer',
        'hints',
        'explanation',
        'tolerance',
        'check',
      ])
        expect(p, `${i.kind}.${k}`).not.toHaveProperty(k)
    }
    expect(publicItem(items[0]!, 's')).toMatchObject({ hintCount: 1 })
    expect(publicItem(items[3]!, 's')).toMatchObject({ blankCount: 1 })
    expect(publicItem(items[4]!, 's')).toMatchObject({ unit: 'st' })

    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const o = item({ kind: 'ordering', items: choices.slice(0, 2), answer: ['a', 'b'] })
      const p = publicItem(o, seed) as { items: { id: string }[] }
      expect(p.items.map((c) => c.id)).toEqual(['b', 'a'])
    }
    const m = item({
      kind: 'matching',
      pairs: [
        { left: '1', right: 'ett' },
        { left: '2', right: 'två' },
      ],
    })
    const pm = publicItem(m, 'x') as { left: string[]; right: string[] }
    expect(pm.left).toEqual(['1', '2'])
    expect([...pm.right].sort()).toEqual(['ett', 'två'])
    expect(pm).not.toHaveProperty('pairs')
  })

  it('solution text is Swedish display form', () => {
    expect(solutionText(item({ kind: 'numeric', answer: 2.5, unit: 'kg' }))).toBe('2,5 kg')
    expect(solutionText(item({ kind: 'trueFalse', answer: true }))).toBe('Sant')
    expect(solutionText(item({ kind: 'multiSelect', choices, answers: ['a', 'c'] }))).toBe('A, C')
  })
})
