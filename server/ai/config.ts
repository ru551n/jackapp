import { AiCapability, CAPABILITY_ENV_PREFIX, type ProviderKind } from '../../shared/contracts'
import { ConfigError } from '../config/env'
import type { StructuredMode } from './types'

// AI_<CAP>_* parsing (contract: docs/platform/env.md). Error messages name variables, never values.

export type ResearchProviderKind = 'searxng' | 'brave' | 'tavily' | 'mock'
export type ModelCapability = Exclude<AiCapability, 'research'>

export interface ModelCapConfig {
  capability: ModelCapability
  provider: ProviderKind
  baseUrl: string
  apiKey?: string
  model: string
  timeoutMs: number
  structured: StructuredMode
}

export interface ResearchCapConfig {
  capability: 'research'
  provider: ResearchProviderKind
  baseUrl: string
  apiKey?: string
  timeoutMs: number
}

export type CapConfig = ModelCapConfig | ResearchCapConfig

export interface AiConfig {
  text?: ModelCapConfig
  vision?: ModelCapConfig
  image?: ModelCapConfig
  embedding?: ModelCapConfig
  research?: ResearchCapConfig
}

const DEFAULT_BASE: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  brave: 'https://api.search.brave.com',
  tavily: 'https://api.tavily.com',
  mock: 'http://mock.invalid',
}

/** Providers each capability accepts (Anthropic has no image or embedding API). */
const ALLOWED: Record<AiCapability, readonly string[]> = {
  text: ['openai', 'anthropic', 'openai-compatible', 'anthropic-compatible', 'mock'],
  vision: ['openai', 'anthropic', 'openai-compatible', 'anthropic-compatible', 'mock'],
  image: ['openai', 'openai-compatible', 'mock'],
  embedding: ['openai', 'openai-compatible', 'mock'],
  research: ['searxng', 'brave', 'tavily', 'mock'],
}
const CLOUD = ['openai', 'anthropic']
const LOCAL = ['openai-compatible', 'anthropic-compatible']
const NEEDS_KEY = ['openai', 'anthropic', 'brave', 'tavily']
const STRUCTURED: readonly StructuredMode[] = ['auto', 'json_schema', 'json_mode', 'prompt']

const flag = (v: string | undefined, def: boolean) =>
  v === undefined || v === '' ? def : ['true', '1', 'yes'].includes(v)

/** Parse all capabilities. Unset PROVIDER = disabled. Throws ConfigError listing every problem. */
export function parseAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const problems: string[] = []
  const allowCloud = flag(env.ALLOW_CLOUD_AI, true)
  const allowLocal = flag(env.ALLOW_LOCAL_AI, true)
  const cfg: AiConfig = {}

  for (const cap of AiCapability.options) {
    const p = CAPABILITY_ENV_PREFIX[cap]
    const get = (k: string) => env[`${p}_${k}`]?.trim() || undefined
    const provider = get('PROVIDER')
    if (!provider) continue
    if (!ALLOWED[cap].includes(provider)) {
      problems.push(`${p}_PROVIDER: must be one of ${ALLOWED[cap].join(', ')}`)
      continue
    }
    if (!allowCloud && CLOUD.includes(provider)) problems.push(`${p}_PROVIDER: cloud AI is disabled (ALLOW_CLOUD_AI)`)
    if (!allowLocal && LOCAL.includes(provider)) problems.push(`${p}_PROVIDER: local AI is disabled (ALLOW_LOCAL_AI)`)

    const baseUrl = get('BASE_URL') ?? DEFAULT_BASE[provider]
    if (!baseUrl) problems.push(`${p}_BASE_URL: required for provider ${provider}`)
    else if (!isHttpUrl(baseUrl)) problems.push(`${p}_BASE_URL: must be an http(s) URL`)
    const apiKey = get('API_KEY')
    if (!apiKey && NEEDS_KEY.includes(provider)) problems.push(`${p}_API_KEY: required for provider ${provider}`)

    const rawTimeout = get('TIMEOUT_MS')
    const timeoutMs = rawTimeout === undefined ? (cap === 'image' ? 300_000 : 120_000) : Number(rawTimeout)
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) problems.push(`${p}_TIMEOUT_MS: must be a positive integer`)

    if (cap === 'research') {
      cfg.research = {
        capability: 'research',
        provider: provider as ResearchProviderKind,
        baseUrl: baseUrl ?? '',
        apiKey,
        timeoutMs,
      }
      continue
    }
    const model = get('MODEL') ?? (provider === 'mock' ? 'mock' : undefined)
    if (!model) problems.push(`${p}_MODEL: required`)
    const structured = (get('STRUCTURED') ?? 'auto') as StructuredMode
    if (!STRUCTURED.includes(structured)) problems.push(`${p}_STRUCTURED: must be one of ${STRUCTURED.join(', ')}`)
    cfg[cap] = {
      capability: cap,
      provider: provider as ProviderKind,
      baseUrl: baseUrl ?? '',
      apiKey,
      model: model ?? '',
      timeoutMs,
      structured,
    }
  }
  if (problems.length) throw new ConfigError(problems)
  return cfg
}

function isHttpUrl(s: string) {
  try {
    return ['http:', 'https:'].includes(new URL(s).protocol)
  } catch {
    return false
  }
}

export interface CapDescription {
  provider: string
  model?: string
  keySet: boolean
  /** Host (and port) only: no credentials, path or query. */
  host: string
}

/** Startup diagnostics: safe to log. */
export function describeAiConfig(cfg: AiConfig): Record<AiCapability, CapDescription | 'disabled'> {
  const out = {} as Record<AiCapability, CapDescription | 'disabled'>
  for (const cap of AiCapability.options) {
    const c = cfg[cap]
    out[cap] = c
      ? {
          provider: c.provider,
          ...('model' in c ? { model: c.model } : {}),
          keySet: !!c.apiKey,
          host: new URL(c.baseUrl).host,
        }
      : 'disabled'
  }
  return out
}

export interface AiLimits {
  requestsPerHour: number
  concurrency: number
}

/** LIMIT_AI_* (contract: docs/platform/env.md#limits). */
export function parseAiLimits(env: NodeJS.ProcessEnv = process.env): AiLimits {
  const problems: string[] = []
  const int = (name: string, def: number) => {
    const raw = env[name]?.trim()
    const v = raw ? Number(raw) : def
    if (!Number.isInteger(v) || v <= 0) problems.push(`${name}: must be a positive integer`)
    return v
  }
  const limits = {
    requestsPerHour: int('LIMIT_AI_REQUESTS_PER_HOUR', 2000),
    concurrency: int('LIMIT_AI_CONCURRENCY', 4),
  }
  if (problems.length) throw new ConfigError(problems)
  return limits
}
