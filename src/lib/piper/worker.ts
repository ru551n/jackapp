/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/wasm'
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import createPhonemizer from '@diffusionstudio/piper-wasm/build/piper_phonemize.js'
import phonemizeWasm from '@diffusionstudio/piper-wasm/build/piper_phonemize.wasm?url'
import phonemizeData from '@diffusionstudio/piper-wasm/build/piper_phonemize.data?url'
import voices from '../../../scripts/speech/voices.json'
import { cachedBytes } from './assets'
import { phonemesToIds } from './phonemes'
import { floatToWav } from './wav'
import type { Reply, Request } from './protocol'

interface Config {
  audio: { sample_rate: number }
  espeak: { voice: string }
  inference: { noise_scale: number; length_scale: number; noise_w: number }
  phoneme_id_map: Record<string, number[]>
  num_speakers: number
}
interface Phonemizer {
  run: (voice: string, text: string) => string[]
}

const post = (r: Reply) => postMessage(r)
const downloads = new Map<string, [number, number]>()
const progress = (url: string) => (loaded: number, total: number) => {
  downloads.set(url, [loaded, total])
  let l = 0
  let t = 0
  downloads.forEach(([a, b]) => ((l += a), (t += b)))
  post({ type: 'progress', value: t ? l / t : 0 })
}

async function loadPhonemizer(): Promise<Phonemizer> {
  const [wasm, data] = await Promise.all([
    cachedBytes(phonemizeWasm, progress(phonemizeWasm)),
    cachedBytes(phonemizeData, progress(phonemizeData)),
  ])
  let out = ''
  const dataUrl = URL.createObjectURL(new Blob([data]))
  const mod = await createPhonemizer({
    wasmBinary: wasm,
    print: (s: string) => (out = s),
    printErr: () => {},
    locateFile: (f: string) => (f.endsWith('.data') ? dataUrl : f),
  })
  return {
    run(voice, text) {
      out = ''
      mod.callMain(['-l', voice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data'])
      return JSON.parse(out).phonemes
    },
  }
}

let runtime: Promise<Phonemizer> | undefined
async function init() {
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1
  ort.env.wasm.wasmBinary = await cachedBytes(ortWasm, progress(ortWasm))
  return loadPhonemizer()
}

const models = new Map<string, Promise<{ cfg: Config; session: ort.InferenceSession }>>()
function loadModel(base: string, lang: keyof typeof voices) {
  const url = `${base}${voices[lang]}.onnx`
  return (async () => {
    const [cfgBytes, model] = await Promise.all([cachedBytes(`${url}.json`), cachedBytes(url, progress(url))])
    const cfg = JSON.parse(new TextDecoder().decode(cfgBytes)) as Config
    return { cfg, session: await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ['wasm'] }) }
  })()
}

async function synth(base: string, lang: keyof typeof voices, text: string) {
  runtime ??= init()
  if (!models.has(lang)) models.set(lang, loadModel(base, lang))
  const [phonemizer, { cfg, session }] = await Promise.all([runtime, models.get(lang)!])
  const ids = phonemesToIds(phonemizer.run(cfg.espeak.voice, text), cfg.phoneme_id_map)
  const i = cfg.inference
  const feeds: Record<string, ort.Tensor> = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.of(BigInt(ids.length)), [1]),
    scales: new ort.Tensor('float32', Float32Array.of(i.noise_scale, i.length_scale, i.noise_w), [3]),
  }
  if (cfg.num_speakers > 1) feeds.sid = new ort.Tensor('int64', BigInt64Array.of(0n), [1])
  const { output } = await session.run(feeds)
  return floatToWav(output!.data as Float32Array, cfg.audio.sample_rate)
}

// One request at a time: the phonemizer and sessions are not re-entrant.
let queue: Promise<unknown> = Promise.resolve()
self.onmessage = ({ data }: MessageEvent<Request>) => {
  queue = queue.then(async () => {
    try {
      const wav = await synth(data.base, data.lang, data.text)
      post({ type: 'done', id: data.id, wav })
      post({ type: 'ready' })
    } catch (e) {
      post({ type: 'failed', id: data.id, message: String(e) })
    }
  })
}
