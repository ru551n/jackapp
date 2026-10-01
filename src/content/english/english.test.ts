import { describe, expect, it } from 'vitest'
import { createRng } from '../../core/rng'
import type { Level, Question, Support } from '../../core/types'
import { ENGLISH_GENERATORS } from './index'
import { COLORS, EXTRA_WORDS, NOUNS, NUMBER_WORDS } from './vocab'

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 104729 + 3)
const SUPPORTS: Support[] = ['normal', 'extra']
const SWEDISH_PROMPT = /^(Tryck|Vilk|Vad|Hur|Lyssna)/

function all(fn: (q: Question, gen: string, level: Level, support: Support) => void) {
  for (const g of ENGLISH_GENERATORS)
    for (let l = g.levels[0]; l <= g.levels[1]; l++)
      for (const s of SUPPORTS)
        for (const seed of SEEDS)
          fn(g.generate({ rng: createRng(seed), level: l as Level, support: s }), g.id, l as Level, s)
}

const ENGLISH_WORDS = [
  ...NOUNS.map((n) => n.en),
  ...COLORS.map((c) => c.en),
  ...EXTRA_WORDS.map((w) => w.en),
  ...NUMBER_WORDS.slice(1),
  'big',
  'small',
  'fast',
  'slow',
]
const has = (text: string, w: string) => new RegExp(`\\b${w}\\b`, 'i').test(text)

describe('english content', () => {
  it('covers all six skills and levels 1-5', () => {
    for (const skill of ['en.words', 'en.colors', 'en.numbers', 'en.adjectives', 'en.listen', 'en.sentences']) {
      const levels = new Set<number>()
      for (const g of ENGLISH_GENERATORS.filter((x) => x.skill === skill))
        for (let l = g.levels[0]; l <= g.levels[1]; l++) levels.add(l)
      expect([...levels].sort(), skill).toEqual([1, 2, 3, 4, 5])
    }
    expect(ENGLISH_GENERATORS.length).toBeGreaterThanOrEqual(10)
  })

  it('speech is Swedish only', () => {
    all((q) => {
      for (const w of ENGLISH_WORDS) expect(has(q.speech ?? '', w), `${q.id}: speech has "${w}"`).toBe(false)
    })
  })

  it('Swedish support fades with level', () => {
    all((q, gen, level, support) => {
      if (q.skill === 'en.listen') return
      const sw = SWEDISH_PROMPT.test(q.prompt)
      if (level <= 2 || support === 'extra') expect(sw, q.prompt).toBe(true)
      else expect(sw, `${gen}: ${q.prompt}`).toBe(false)
    })
  })

  it('every en.listen question has English audio and a hint that shows the word', () => {
    all((q) => {
      if (q.skill !== 'en.listen') return
      expect(q.listen?.lang).toBe('en')
      const scene = q.hints[0].scene
      expect(scene?.kind).toBe('sign')
      expect(scene && scene.kind === 'sign' && scene.text).toBe(q.listen?.text)
    })
  })

  it('colour answers match the colour asked', () => {
    all((q) => {
      if (q.skill !== 'en.colors' || q.task.kind !== 'choice') return
      const asked = COLORS.find((c) => has(q.prompt, c.en) || has(q.listen?.text ?? '', c.en))!
      expect(q.task.answer.startsWith(asked.tint), q.id).toBe(true)
      const noun = NOUNS.find((n) => has(q.prompt, n.en))
      if (noun) expect(q.task.answer.endsWith(`:${noun.en}`), q.id).toBe(true)
    })
  })

  it('counts match the number of sprites', () => {
    all((q) => {
      if (q.id.startsWith('en.numbers.howMany') && q.scene?.kind === 'row' && q.task.kind === 'choice')
        expect(q.scene.items.length, q.id).toBe(Number(q.task.answer))
      if (q.id.startsWith('en.sentences') && q.task.kind === 'choice') {
        const n = NUMBER_WORDS.findIndex((w) => w && has(q.listen?.text ?? '', w))
        if (/^I see (two|three|one)/.test(q.listen?.text ?? '')) expect(Number(q.task.answer), q.id).toBe(n)
      }
    })
  })

  it('big is the larger scale, small the smaller', () => {
    all((q) => {
      if (q.task.kind !== 'choice' || !/\b(big|small)\b/.test(q.listen?.text ?? '')) return
      if (q.skill === 'en.numbers') return
      const scales = q.task.choices.map((c) => (c.visual?.kind === 'vehicle' ? c.visual.scale! : NaN))
      if (scales.some(Number.isNaN)) return
      const big = /\bbig\b/.test(q.listen!.text)
      expect(Number(q.task.answer), q.id).toBe(big ? Math.max(...scales) : Math.min(...scales))
    })
  })

  it('fast is a plane, slow is road traffic', () => {
    all((q) => {
      if (!q.id.startsWith('en.adjectives.fastSlow') || q.task.kind !== 'choice') return
      const fast = /\bfast\b/.test(q.listen!.text)
      expect(['plane', 'jet'].includes(q.task.answer), q.id).toBe(fast)
    })
  })
})
