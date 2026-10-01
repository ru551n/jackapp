import type { FastifyBaseLogger } from 'fastify'
import { AiCapability, REQUIRED_CAPABILITIES, type CapabilityStatus } from '../../shared/contracts'
import type { ReadinessCheck, ReadinessResult } from '../app/context'
import type { Db } from '../db/client'
import { anthropicChat, anthropicProbe } from './anthropic'
import { parseAiConfig, parseAiLimits, type AiConfig, type CapConfig, type ModelCapConfig } from './config'
import { countRequest, Semaphore } from './limits'
import { MOCK_PNG, mockChat, mockEmbedding, type MockScripts } from './mock'
import { openAiChat, openAiEmbed, openAiImages, openAiProbe } from './openai'
import { createResearch, researchProbe } from './research'
import { generate } from './structured'
import {
  AiError,
  type ChatFn,
  type Embeddings,
  type ImageGeneration,
  type TextGeneration,
  type Vision,
  type WebResearch,
} from './types'

export * from './types'
export { describeAiConfig, parseAiConfig, parseAiLimits } from './config'

export interface AiServices {
  text?: TextGeneration
  vision?: Vision
  image?: ImageGeneration
  embedding?: Embeddings
  research?: WebResearch
  /** Last known state; reachability is 'unknown' until a readiness probe ran. Safe for clients. */
  status(): CapabilityStatus[]
  readiness: ReadinessCheck[]
}

declare module '../app/context' {
  interface AppContext {
    ai?: AiServices
  }
}

export interface CreateAiOptions {
  db: Db
  log: Pick<FastifyBaseLogger, 'info' | 'warn'>
  /** Script the mock provider (tests). */
  mock?: MockScripts
  /** Reachability probe cache (default 60 s). */
  probeTtlMs?: number
}

const NAMES: Record<AiCapability, [available: string, disabled: string]> = {
  text: ['AI-textgenerering', 'Textgenerering'],
  vision: ['AI-bildtolkning', 'Bildtolkning'],
  image: ['AI-bildgenerering', 'Bildgenerering'],
  embedding: ['AI-sökning i material', 'Sökning i material'],
  research: ['Webbsökning', 'Webbsökning'],
}

type Probe = ReadinessResult & { reachable: CapabilityStatus['reachable'] }

/** Build the AI services from env. Throws ConfigError on invalid configuration. */
export function createAi(env: NodeJS.ProcessEnv, opts: CreateAiOptions): AiServices {
  const cfg: AiConfig = parseAiConfig(env)
  const limits = parseAiLimits(env)
  const sem = new Semaphore(limits.concurrency)
  const { db, log } = opts

  /** Every provider request: hourly count, concurrency slot, safe log line (no prompts/keys/URLs). */
  async function call<T>(c: CapConfig, fn: () => Promise<T>, limited = true): Promise<T> {
    const meta = { capability: c.capability, provider: c.provider, model: 'model' in c ? c.model : undefined }
    const t0 = performance.now()
    try {
      if (limited) await countRequest(db, limits.requestsPerHour)
      const r = await (limited ? sem.run(fn) : fn())
      const usage = (r as { usage?: unknown })?.usage
      log.info({ ai: { ...meta, durationMs: Math.round(performance.now() - t0), usage } }, 'ai request')
      return r
    } catch (e) {
      const error = e instanceof AiError ? e.code : (e as Error)?.name === 'AbortError' ? 'aborted' : 'internal'
      const detail = e instanceof AiError ? e.detail : undefined
      log.warn({ ai: { ...meta, durationMs: Math.round(performance.now() - t0), error, detail } }, 'ai request failed')
      throw e
    }
  }

  const chatFor = (c: ModelCapConfig, script?: MockScripts['text']): ChatFn => {
    const raw =
      c.provider === 'mock'
        ? mockChat(c.model, script)
        : c.provider === 'anthropic' || c.provider === 'anthropic-compatible'
          ? anthropicChat(c)
          : openAiChat(c)
    return (req) => call(c, () => raw(req))
  }

  const services: AiServices = { status, readiness: [] }
  if (cfg.text) {
    const chat = chatFor(cfg.text, opts.mock?.text)
    const mode = cfg.text.structured
    services.text = { generate: (input: any) => generate(chat, mode, input) } as TextGeneration
  }
  if (cfg.vision) {
    const chat = chatFor(cfg.vision, opts.mock?.vision)
    const mode = cfg.vision.structured
    services.vision = { generate: (input: any) => generate(chat, mode, input) } as Vision
  }
  if (cfg.image) {
    const c = cfg.image
    services.image = {
      generate: (input) =>
        call(c, async () => ({
          images:
            c.provider === 'mock'
              ? Array.from({ length: input.n }, () => ({ data: MOCK_PNG, mimeType: 'image/png' }))
              : await openAiImages(c, input),
          model: c.model,
        })),
    }
  }
  if (cfg.embedding) {
    const c = cfg.embedding
    services.embedding = {
      embed: (texts, o) =>
        call(c, async () =>
          c.provider === 'mock'
            ? {
                vectors: texts.map(mockEmbedding),
                usage: { inputTokens: texts.length, outputTokens: 0 },
                model: c.model,
              }
            : openAiEmbed(c, texts, o?.signal),
        ),
    }
  }
  if (cfg.research) {
    const c = cfg.research
    const r = createResearch(c)
    // Web search is not an AI model call: no AI rate limit or concurrency slot.
    services.research = { search: (input) => call(c, () => r.search(input), false) }
  }

  // ---- Reachability (lazy, cached) ----
  const ttl = opts.probeTtlMs ?? 60_000
  const cache = new Map<AiCapability, { at: number; result: Promise<Probe> }>()
  const last = new Map<AiCapability, Probe>()

  async function runProbe(c: CapConfig): Promise<Probe> {
    if (c.provider === 'mock') return { ok: true, reachable: 'yes', detail: 'reachable' }
    const timeoutMs = Math.min(c.timeoutMs, 5000)
    const req =
      c.capability === 'research'
        ? researchProbe(c, timeoutMs)
        : c.provider === 'anthropic' || c.provider === 'anthropic-compatible'
          ? anthropicProbe(c, timeoutMs)
          : openAiProbe(c, timeoutMs)
    if (!req) return { ok: true, reachable: 'unknown', detail: 'configured' }
    try {
      await (await req).body?.cancel()
      return { ok: true, reachable: 'yes', detail: 'reachable' }
    } catch (e) {
      const code = e instanceof AiError ? e.code : 'ai_unavailable'
      if (code === 'ai_auth') return { ok: false, reachable: 'yes', detail: 'authentication failed' }
      if (code === 'ai_unavailable') return { ok: false, reachable: 'no', detail: 'unreachable' }
      // Any other HTTP answer (404 without /models, 429): the endpoint is up.
      return { ok: true, reachable: 'yes', detail: 'reachable' }
    }
  }

  function probe(cap: AiCapability, c: CapConfig): Promise<Probe> {
    const hit = cache.get(cap)
    if (hit && Date.now() - hit.at < ttl) return hit.result
    const result = runProbe(c).then((p) => (last.set(cap, p), p))
    cache.set(cap, { at: Date.now(), result })
    return result
  }

  services.readiness = AiCapability.options.map((cap) => ({
    name: `ai.${cap}`,
    critical: REQUIRED_CAPABILITIES.includes(cap),
    async check(): Promise<ReadinessResult> {
      const c = cfg[cap]
      if (!c) return { ok: false, detail: 'not configured' }
      const { ok, detail } = await probe(cap, c)
      return { ok, detail }
    },
  }))

  function status(): CapabilityStatus[] {
    return AiCapability.options.map((cap) => {
      const configured = !!cfg[cap]
      const p = configured ? last.get(cap) : undefined
      const reachable = p?.reachable ?? 'unknown'
      const [on, off] = NAMES[cap]
      const label = !configured
        ? `${off} är inte aktiverad`
        : p && !p.ok
          ? `${on} är inte tillgänglig just nu`
          : `${on} är tillgänglig`
      return { capability: cap, configured, reachable, label }
    })
  }

  return services
}
