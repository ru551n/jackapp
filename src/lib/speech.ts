import { useSyncExternalStore } from 'react'
import type { SpeechLang } from '../core/types'
import { isEngineSupported, synthesize as piperSynthesize } from './piper'
import { speechKey } from './spoken'

// Speech playback, in order: bundled clip (public/audio, built with Piper: docs/audio.md) -> in-browser
// Piper clip (cached) -> the device voice. Same voice everywhere. Never autoplays.

const LOCALES: Record<SpeechLang, string> = { sv: 'sv-SE', en: 'en-GB' }
const AUDIO_DIR = 'audio/'
// Past this wait for the engine (first model load) the device voice speaks instead.
const ENGINE_WAIT_MS = 4000
// 1 sample of silence: played inside the tap so iOS lets us set the real src later.
const SILENCE = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQIAAAAA'

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

/** True when this text can be spoken: a bundled clip, the Piper engine, or a browser voice. */
export const canSpeak = (text: string, lang: SpeechLang = 'sv') =>
  hasClip(text, lang) || isEngineSupported() || synthAvailable()

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
export const hasSwedishSpeech = () =>
  clips.size > 0 || isEngineSupported() || (synthAvailable() && voiceFor('sv') !== undefined)

function deviceSpeak(text: string, lang: SpeechLang) {
  if (!synthAvailable()) return
  const synth = window.speechSynthesis
  const u = new SpeechSynthesisUtterance(text)
  u.lang = LOCALES[lang]
  u.rate = lang === 'en' ? 0.8 : 0.85
  const voice = voiceFor(lang)
  if (voice) u.voice = voice
  synth.speak(u)
}

let seq = 0

/** Piper clip played on a gesture-created Audio element; any failure or a slow load -> device voice. */
function playEngine(text: string, lang: SpeechLang) {
  if (!isEngineSupported()) return deviceSpeak(text, lang)
  const mine = seq
  const audio = new Audio(SILENCE)
  current = audio
  audio.play().catch(() => {}) // unlocks the element for the later src swap (iOS)
  const stale = () => mine !== seq
  const timer = setTimeout(() => {
    if (!stale()) deviceSpeak(text, lang)
    seq++ // the late clip is cached for next time but must not play now
  }, ENGINE_WAIT_MS)
  piperSynthesize(text, lang).then(
    (blob) => {
      clearTimeout(timer)
      if (stale()) return
      const url = URL.createObjectURL(blob)
      audio.onended = () => URL.revokeObjectURL(url)
      audio.src = url
      audio.play().catch(() => !stale() && deviceSpeak(text, lang))
    },
    () => {
      clearTimeout(timer)
      if (!stale()) deviceSpeak(text, lang)
    },
  )
}

export function speak(text: string, lang: SpeechLang = 'sv') {
  stopSpeaking()
  if (!hasClip(text, lang)) return playEngine(text, lang)
  const audio = new Audio(`${AUDIO_DIR}${speechKey({ text, lang })}.mp3`)
  current = audio
  audio.play().catch(() => {
    if (current === audio) deviceSpeak(text, lang)
  })
}

export function stopSpeaking() {
  seq++
  current?.pause()
  current = null
  if (synthAvailable()) window.speechSynthesis.cancel()
}

if (typeof window !== 'undefined' && (import.meta.env.DEV || location.search.includes('speechtest'))) {
  ;(window as unknown as { __jackappSpeech: unknown }).__jackappSpeech = { synthesize: piperSynthesize }
}
