import type { MockChatHandler } from './mock'
import { sample } from './mock'

// Scripted mock text model for `npm run dev:all` (server/dev.ts): small, deterministic, varied and
// *valid* generation output (addition practice), so local and e2e flows produce approvable
// material without a real model. Unknown prompts fall back to the minimal schema sample.

const SKILL = 'math.addition.within-100'
const ADD = /skills: varje uppgift ska ha en av dessa färdighetstaggar[^:]*: ([^,.\s]+)/

const kindsOf = (items: any): string[] =>
  (items.anyOf ?? items.oneOf ?? [items]).map((o: any) => o.properties.kind.const)

/** One checkable addition item of `kind`; `n` varies the numbers. */
function item(kind: string, n: number, skill: string) {
  const a = 3 + (n % 9)
  const b = 4 + ((n * 7) % 11)
  const sum = a + b
  const base = {
    difficulty: 2,
    skills: [skill],
    hints: ['Börja med det största talet och räkna vidare.'],
    explanation: `Talen tillsammans blir ${sum}.`,
  }
  switch (kind) {
    case 'multipleChoice':
      return {
        kind,
        prompt: `Vad är ${a} + ${b}?`,
        choices: [`${sum}`, `${sum + 1}`, `${sum - 2}`],
        correctIndex: 0,
        ...base,
      }
    case 'multiSelect':
      return {
        kind,
        prompt: `Vilka summor blir exakt ${sum}?`,
        choices: [`${a} + ${b}`, `${b} + ${a}`, `${a} + ${b + 1}`],
        correctIndexes: [0, 1],
        ...base,
      }
    case 'trueFalse':
      return { kind, prompt: `Stämmer det att ${a} plus ${b} blir ${sum + (n % 2)}?`, answer: n % 2 === 0, ...base }
    case 'fillBlank':
      return { kind, prompt: 'Fyll i summan.', text: `${a} + ${b} = ___`, blanks: [[`${sum}`]], ...base }
    case 'matching':
      return {
        kind,
        prompt: 'Para ihop uträkningen med summan.',
        pairs: [
          { left: `${a} + ${b}`, right: `${sum}` },
          { left: `${a} + ${b + 2}`, right: `${sum + 2}` },
          { left: `${a + 5} + ${b}`, right: `${sum + 5}` },
        ],
        ...base,
      }
    case 'ordering':
      return {
        kind,
        prompt: 'Ordna summorna från minst till störst.',
        correctOrder: [`${sum}`, `${sum + 3}`, `${sum + 8}`],
        ...base,
      }
    case 'numeric':
      return { kind, prompt: `Räkna ut ${a} + ${b}.`, answer: sum, check: `${a}+${b}`, ...base }
    case 'freeText':
      return {
        kind,
        prompt: `Förklara hur du kan räkna ut ${a} + ${b} i huvudet.`,
        rubric: ['Delar upp talen', 'Kommer fram till rätt summa'],
        sampleAnswer: `Jag tar ${a} och lägger till ${b}, det blir ${sum}.`,
        ...base,
      }
    default:
      return { kind: 'flashcard', prompt: `${a} + ${b}`, back: `${sum}`, ...base }
  }
}

const SEGMENT = /^\[([^\]]+)\] \(sida \d+, [^)]+\) (.+)$/gm

/**
 * Strict source mode: items cite the longest uploaded segments. True/false and free-text items quote
 * the segment (free text: its rubric point is the segment's opening words).
 */
function grounded(out: { items: Record<string, unknown>[] }, system: string, kinds: string[]) {
  const segs = [...system.matchAll(SEGMENT)].map((m) => ({ id: m[1]!, text: m[2]!.trim() }))
  if (!segs.length) return out
  segs.sort((a, b) => b.text.length - a.text.length)
  out.items = out.items.map((item, i) => {
    const seg = segs[i % segs.length]!
    if (item.kind === 'freeText') {
      const words = seg.text
        .split(/\s+/)
        .slice(0, 3)
        .join(' ')
        .replace(/[.!?,;:]$/, '')
      return {
        ...item,
        prompt: `Skriv med egna ord vad texten berättar om "${words}".`,
        rubric: [seg.text.slice(0, 200)],
        sampleAnswer: seg.text.slice(0, 500),
        hints: ['Läs texten en gång till.'],
        explanation: `Det står i texten: ${seg.text.slice(0, 300)}`,
        sourceSegmentIds: [seg.id],
      }
    }
    if (!kinds.includes('trueFalse')) return { ...item, sourceSegmentIds: [seg.id] }
    return {
      kind: 'trueFalse',
      prompt: `Sant eller falskt: ${seg.text.replace(/[.!?]$/, '')}.`,
      answer: true,
      difficulty: 2,
      skills: item.skills,
      hints: ['Läs texten en gång till.'],
      explanation: `Det står i texten: ${seg.text}`,
      sourceSegmentIds: [seg.id],
    }
  })
  return out
}

const words = (s: string) => new Set(s.toLowerCase().match(/\p{L}{4,}/gu) ?? [])

/** Free-text grading: a key point is met when the answer shares a word (4+ letters) with it. */
function assess(content: string) {
  const { nyckelpunkter = [], elevsvar = '' } = JSON.parse(content) as { nyckelpunkter?: string[]; elevsvar?: string }
  const said = words(elevsvar)
  const keyPoints = nyckelpunkter.map((p, index) => {
    const hit = [...words(p.replace(/^\d+: /, ''))].find((w) => said.has(w))
    return { index, verdict: hit ? 'met' : 'missing', evidence: hit ?? '' }
  })
  const met = keyPoints.filter((k) => k.verdict === 'met').length
  return {
    keyPoints,
    feedback: met ? 'Bra! Du har fått med något viktigt.' : 'Bra försök! Titta på punkterna och lägg till mer.',
  }
}

let counter = 0

export const devMockText: MockChatHandler = (req) => {
  const js = req.json?.jsonSchema as any
  switch (req.json?.name) {
    case 'request_fields':
      return {}
    case 'free_text_assessment':
      return assess(String(req.messages.at(-1)?.content ?? '{}'))
    case 'artifact_texts':
      return {
        title: 'Addition i vardagen',
        bodies: Array.from(
          { length: js.properties.bodies.minItems },
          (_, i) =>
            `När vi lägger ihop två tal får vi en summa. Del ${i + 1}: börja med det största talet och räkna vidare.`,
        ),
      }
    case 'artifact_items': {
      const kinds = kindsOf(js.properties.items.items)
      const skill = ADD.exec(req.system ?? '')?.[1] ?? SKILL
      const out = {
        title: 'Addition',
        items: Array.from({ length: js.properties.items.minItems }, () => {
          const n = counter++
          return item(kinds[n % kinds.length]!, n, skill)
        }),
      }
      return (req.system ?? '').includes('Källläge STRIKT') ? grounded(out, req.system!, kinds) : out
    }
    default:
      return req.json ? sample(req.json.jsonSchema) : 'Mock-svar.'
  }
}
