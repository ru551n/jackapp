import { useSyncExternalStore } from 'react'
import type { SpeechLang } from '../core/types'
import { speechKey } from './spoken'

// Speech playback. Prefers pre-generated clips (public/audio, built with Piper: docs/audio.md) so
// every device sounds the same; falls back to the browser's own voice. Never autoplays.

const LOCALES: Record<SpeechLang, string> = { sv: 'sv-SE', en: 'en-GB' }
const AUDIO_DIR = 'audio/'

let clips = new Set<string>()
let clipsLoaded = false
const listeners = new Set<() => void>()
let current: HTMLAudioElement | null = null

/** Load the clip manifest once at startup (a small JSON list; no audio is fetched until asked). */
export function preloadSpeech() {
  if (clipsLoaded || typeof fetch === 'undefined') return
  clipsLoaded = true
  fetch(`${AUDIO_DIR}manifest.json`)
    .then((r) => (r.ok ? r.json() : []))
    .then((keys: unknown) => {
      if (Array.isArray(keys)) clips = new Set(keys.filter((k): k is string => typeof k === 'string'))
      listeners.forEach((l) => l())
    })
    .catch(() => {})
}

const synthAvailable = () => typeof window !== 'undefined' && 'speechSynthesis' in window

export const hasClip = (text: string, lang: SpeechLang) => clips.has(speechKey({ text, lang }))

function voiceFor(lang: SpeechLang): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices()
  const exact = voices.find((v) => v.lang.replace('_', '-') === LOCALES[lang])
  return exact ?? voices.find((v) => v.lang.toLowerCase().startsWith(lang))
}

/** True when this text can be spoken: a bundled clip, or a browser voice as fallback. */
export const canSpeak = (text: string, lang: SpeechLang = 'sv') => hasClip(text, lang) || synthAvailable()

/** Re-render when the clip manifest arrives. */
export const useSpeechReady = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => clips.size,
  )

/** Parent info: is natural Swedish speech available (bundled clips or an installed voice)? */
export const hasSwedishSpeech = () => clips.size > 0 || (synthAvailable() && voiceFor('sv') !== undefined)

function synthesize(text: string, lang: SpeechLang) {
  if (!synthAvailable()) return
  const synth = window.speechSynthesis
  const u = new SpeechSynthesisUtterance(text)
  u.lang = LOCALES[lang]
  u.rate = lang === 'en' ? 0.8 : 0.85
  const voice = voiceFor(lang)
  if (voice) u.voice = voice
  synth.speak(u)
}

export function speak(text: string, lang: SpeechLang = 'sv') {
  stopSpeaking()
  if (!hasClip(text, lang)) return synthesize(text, lang)
  const audio = new Audio(`${AUDIO_DIR}${speechKey({ text, lang })}.mp3`)
  current = audio
  audio.play().catch(() => {
    if (current === audio) synthesize(text, lang)
  })
}

export function stopSpeaking() {
  current?.pause()
  current = null
  if (synthAvailable()) window.speechSynthesis.cancel()
}
