import type { SpeechLang } from '../../core/types'
import { getBytes, putBytes } from './store'
import { speechKey } from '../spoken'
import type { Reply, Request } from './protocol'

// In-browser Piper (espeak-ng phonemizer + onnxruntime-web) for text without a bundled clip.
// Everything is self-hosted; models and synthesized clips are cached on the device.

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error'
export interface EngineState {
  status: EngineStatus
  /** Download progress 0..1 while loading. */
  progress: number
}

export const isEngineSupported = () => typeof WebAssembly !== 'undefined' && typeof Worker !== 'undefined'

let state: EngineState = { status: 'idle', progress: 0 }
const listeners = new Set<() => void>()
const setState = (s: EngineState) => {
  if (s.status === state.status && s.progress === state.progress) return
  state = s
  listeners.forEach((l) => l())
}
export const getEngineState = () => state
export function onEngineStatus(cb: () => void) {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}

let worker: Worker | undefined
let nextId = 0
const pending = new Map<number, { ok: (b: Blob) => void; fail: (e: Error) => void }>()

function getWorker() {
  if (worker) return worker
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = ({ data }: MessageEvent<Reply>) => {
    if (data.type === 'progress') setState({ status: 'loading', progress: data.value })
    else if (data.type === 'ready') setState({ status: 'ready', progress: 1 })
    else {
      const p = pending.get(data.id)
      pending.delete(data.id)
      if (data.type === 'done') p?.ok(new Blob([data.wav], { type: 'audio/wav' }))
      else {
        setState({ status: 'error', progress: 0 })
        p?.fail(new Error(data.message))
      }
    }
  }
  w.onerror = () => {
    setState({ status: 'error', progress: 0 })
    pending.forEach((p) => p.fail(new Error('speech worker crashed')))
    pending.clear()
    worker = undefined
  }
  return (worker = w)
}

const inflight = new Map<string, Promise<Blob>>()

function render(text: string, lang: SpeechLang) {
  if (state.status !== 'ready') setState({ status: 'loading', progress: state.progress })
  return new Promise<Blob>((ok, fail) => {
    const id = nextId++
    pending.set(id, { ok, fail })
    const base = new URL('voices/', document.baseURI).href
    getWorker().postMessage({ id, text, lang, base } satisfies Request)
  })
}

/** WAV for this text: from the clip cache, else synthesized once (and then cached). */
export function synthesize(text: string, lang: SpeechLang): Promise<Blob> {
  const key = speechKey({ text, lang })
  let p = inflight.get(key)
  if (!p) {
    p = (async () => {
      const hit = await getBytes(`clip:${key}`)
      if (hit) return new Blob([hit], { type: 'audio/wav' })
      const wav = await render(text.trim(), lang)
      await putBytes(`clip:${key}`, await wav.arrayBuffer())
      return wav
    })().finally(() => inflight.delete(key))
    inflight.set(key, p)
  }
  return p
}
