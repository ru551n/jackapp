import { describe, expect, it } from 'vitest'
import { createRng } from '../../core/rng'
import type { Level, Question, Support } from '../../core/types'
import { ENGLISH_GENERATORS } from './index'
import { COLORS, EXTRA_WORDS, NOUNS, NUMBER_WORDS, PICTURE_NOUNS } from './vocab'

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

// 'pilot' and 'station' are also Swedish, so they cannot be told apart in Swedish speech.
const ENGLISH_WORDS = [
  ...PICTURE_NOUNS.map((n) => n.en).filter((w) => w !== 'station'),
  ...COLORS.map((c) => c.en),
  ...EXTRA_WORDS.map((w) => w.en).filter((w) => w !== 'pilot'),
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

  it('hints with English words have Swedish-only speech', () => {
    all((q) => {
      for (const h of q.hints) {
        const eng = ENGLISH_WORDS.some((w) => has(h.text, w))
        if (eng) expect(h.speech, `${q.id}: hint "${h.text}" needs speech`).toBeTruthy()
        for (const w of ENGLISH_WORDS) expect(has(h.speech ?? '', w), `${q.id}: hint speech has "${w}"`).toBe(false)
      }
    })
  })

  it('English prompts carry promptLang en, Swedish ones do not', () => {
    all((q) => {
      expect(q.promptLang, `${q.id}: ${q.prompt}`).toBe(SWEDISH_PROMPT.test(q.prompt) ? undefined : 'en')
    })
  })

  it('Swedish support fades with level', () => {
    all((q, gen, level, support) => {
      if (q.skill === 'en.listen') return
      const sv = level <= 2 || support === 'extra' || (gen === 'en.words.meaning' && level === 4)
      expect(SWEDISH_PROMPT.test(q.prompt), `${gen} L${level}: ${q.prompt}`).toBe(sv)
      // The word sign stays through L3.
      if (q.skill === 'en.words' && gen !== 'en.words.meaning' && gen.endsWith('tapTheWord'))
        expect(q.scene?.kind === 'sign', gen).toBe(level <= 3 || support === 'extra')
    })
  })

  it('meaning is L4-5 abstract words with same-category choices', () => {
    const g = ENGLISH_GENERATORS.find((x) => x.id === 'en.words.meaning')!
    expect(g.levels).toEqual([4, 5])
    all((q) => {
      if (q.id.startsWith('en.words.meaning') && q.task.kind === 'choice')
        expect(['gate', 'wing', 'pilot', 'airport', 'hello', 'goodbye'], q.id).toContain(q.task.answer)
    })
  })

  it('no look-alike rail vehicles together at L1-3, never plane with jet', () => {
    const rail = ['train', 'tram', 'metro']
    all((q, _g, level) => {
      if (q.task.kind !== 'choice') return
      const nouns = [...new Set(q.task.choices.map((c) => c.id.split(':').pop()!))]
      expect(nouns.filter((n) => n === 'plane' || n === 'jet').length, q.id).toBeLessThan(2)
      if (level <= 3) expect(new Set(nouns.filter((n) => rail.includes(n))).size, q.id).toBeLessThan(2)
    })
  })

  it('Swedish uses the neuter -t form and plurals', () => {
    const bad =
      /\b(röd|blå|grön|gul) (tåg|flygplan|jetplan)\b|\b(två|tre|fyra|fem|sex|sju|åtta|nio|tio) (buss|bil|spårvagn|tunnelbana|resväska|station)\b/
    all((q) => {
      const texts = [q.success ?? '', ...q.hints.flatMap((h) => [h.text, h.speech ?? ''])]
      if (q.task.kind === 'choice') texts.push(...q.task.choices.map((c) => c.ariaLabel ?? ''))
      for (const t of texts) expect(bad.test(t), `${q.id}: "${t}"`).toBe(false)
    })
  })

  it('How many uses n >= 2 when the prompt is English', () => {
    all((q) => {
      if (q.promptLang === 'en' && q.scene?.kind === 'row' && q.id.startsWith('en.numbers.howMany'))
        expect(q.scene.items.length, q.id).toBeGreaterThanOrEqual(2)
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
    const scaleOf = (c: { visual?: import('../../core/types').Scene }) => {
      const v = c.visual
      const s = v?.kind === 'group' ? v.scenes.find((x) => x.kind === 'vehicle') : v
      return s?.kind === 'vehicle' ? s.scale! : NaN
    }
    all((q) => {
      const said = q.listen?.text ?? q.prompt
      if (q.task.kind !== 'choice' || !/\b(big|small)\b/.test(said)) return
      if (q.skill === 'en.numbers') return
      const scales = q.task.choices.map(scaleOf)
      if (scales.some(Number.isNaN)) return
      expect(Number(q.task.answer), q.id).toBe(/\bbig\b/.test(said) ? Math.max(...scales) : Math.min(...scales))
    })
  })

  it('fast is a jet or train, slow is a bus or car, and the prompt names a noun', () => {
    all((q) => {
      if (!q.id.startsWith('en.adjectives.fastSlow') || q.task.kind !== 'choice') return
      const said = q.listen?.text ?? q.prompt
      expect(['jet', 'train'].includes(q.task.answer), q.id).toBe(/\bfast\b/.test(said))
      if (q.promptLang === 'en') expect(q.prompt, q.id).toMatch(/vehicle/)
    })
  })
})
