import type { SpeechLang } from '../core/types'

// Browser speech synthesis. Only ever triggered by a button press (never autoplay).
const LOCALES: Record<SpeechLang, string> = { sv: 'sv-SE', en: 'en-GB' }

export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window

function voiceFor(lang: SpeechLang): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices()
  const exact = voices.find((v) => v.lang.replace('_', '-') === LOCALES[lang])
  return exact ?? voices.find((v) => v.lang.toLowerCase().startsWith(lang))
}

/** True when a voice for the language is installed. Voices load async in some browsers, so re-check on use. */
export const hasVoice = (lang: SpeechLang) => canSpeak() && voiceFor(lang) !== undefined
export const hasSwedishVoice = () => hasVoice('sv')

export function speak(text: string, lang: SpeechLang = 'sv') {
  if (!canSpeak()) return
  const synth = window.speechSynthesis
  synth.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = LOCALES[lang]
  u.rate = lang === 'en' ? 0.8 : 0.85
  const voice = voiceFor(lang)
  if (voice) u.voice = voice
  synth.speak(u)
}

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel()
}
