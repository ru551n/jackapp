import type { Hint, Question, SpeechLang, Vehicle } from '../core/types'

// The exact texts the UI can speak. Shared by the UI and the build-time audio generator,
// so every spoken string has a pre-generated clip (see docs/audio.md).

export interface Utterance {
  text: string
  lang: SpeechLang
}

export const isEnglishPrompt = (q: Question) => q.promptLang === 'en'

/** The prompt button(s) above an exercise. */
export function promptUtterances(q: Question): Utterance[] {
  const out: Utterance[] = isEnglishPrompt(q)
    ? [{ text: q.prompt, lang: 'en' }, ...(q.speech ? [{ text: q.speech, lang: 'sv' as const }] : [])]
    : [{ text: q.speech ?? q.prompt, lang: 'sv' }]
  if (q.listen && !(isEnglishPrompt(q) && q.listen.text === q.prompt)) out.push(q.listen)
  return out
}

export const hintSpeech = (h: Hint) => `Prova igen. ${h.speech ?? h.text}`

export const hintUtterances = (h: Hint): Utterance[] => [
  { text: hintSpeech(h), lang: 'sv' },
  ...(h.listen ? [h.listen] : []),
]

export const vehicleSpeech = (v: Vehicle) => `${v.name}. ${v.facts.join(' ')}`

export const questionUtterances = (q: Question): Utterance[] => [
  ...promptUtterances(q),
  ...q.hints.flatMap(hintUtterances),
]

/** Stable clip id: two FNV-1a 32-bit hashes over UTF-8 → 16 hex chars. Must match scripts/speech. */
export function speechKey(u: Utterance): string {
  const bytes = new TextEncoder().encode(`${u.lang}\n${u.text.trim()}`)
  const fnv = (seed: number) => {
    let h = seed
    for (const b of bytes) h = Math.imul(h ^ b, 16777619) >>> 0
    return h.toString(16).padStart(8, '0')
  }
  return fnv(2166136261) + fnv(0x811c9dc5 ^ 0x5bd1e995)
}
