import type { ZodType } from 'zod'

// Provider-agnostic capability interfaces. Adapters live next to this file; callers only see these.

export type AiErrorCode =
  'ai_unavailable' | 'ai_rate_limited' | 'ai_auth' | 'ai_invalid_output' | 'ai_refused' | 'ai_config'

const MESSAGES: Record<AiErrorCode, string> = {
  ai_unavailable: 'AI-tjänsten svarar inte just nu. Försök igen om en stund.',
  ai_rate_limited: 'AI-tjänsten är tillfälligt överbelastad. Försök igen senare.',
  ai_auth: 'AI-tjänsten nekade åtkomst. En administratör behöver kontrollera inställningarna.',
  ai_invalid_output: 'AI-svaret gick inte att tolka. Försök igen.',
  ai_refused: 'AI-tjänsten ville inte svara på den här förfrågan.',
  ai_config: 'AI-tjänsten är felkonfigurerad. En administratör behöver kontrollera inställningarna.',
}

/** Typed AI failure. `message` is safe Swedish for display; `detail` is safe for logs (never prompts or keys). */
export class AiError extends Error {
  readonly code: AiErrorCode
  readonly retryable: boolean
  readonly status?: number
  readonly detail?: string
  readonly retryAfterMs?: number
  constructor(
    code: AiErrorCode,
    opts: { message?: string; status?: number; detail?: string; retryAfterMs?: number } = {},
  ) {
    super(opts.message ?? MESSAGES[code])
    this.name = 'AiError'
    this.code = code
    this.retryable = code === 'ai_unavailable' || code === 'ai_rate_limited'
    this.status = opts.status
    this.detail = opts.detail
    this.retryAfterMs = opts.retryAfterMs
  }
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface Usage {
  inputTokens: number
  outputTokens: number
}

export interface GenerateInput {
  system?: string
  messages: ChatMessage[]
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
}

export interface StructuredInput<T> extends GenerateInput {
  schema: ZodType<T>
  /** Name shown to the model for the schema/tool, e.g. "exercise_set". */
  schemaName?: string
}

export interface GenerateResult<T> {
  output: T
  usage: Usage
  model: string
}

export interface TextGeneration {
  generate<T>(input: StructuredInput<T>): Promise<GenerateResult<T>>
  generate(input: GenerateInput): Promise<GenerateResult<string>>
}

export interface ImageInput {
  data: Buffer
  mimeType: string
}

/** Images are attached to the last user message. */
export interface Vision {
  generate<T>(input: StructuredInput<T> & { images: ImageInput[] }): Promise<GenerateResult<T>>
  generate(input: GenerateInput & { images: ImageInput[] }): Promise<GenerateResult<string>>
}

export interface GeneratedImage {
  data: Buffer
  mimeType: string
}

export interface ImageGeneration {
  generate(input: {
    prompt: string
    /** e.g. "1024x1024" */
    size: string
    n: number
    signal?: AbortSignal
  }): Promise<{ images: GeneratedImage[]; model: string }>
}

export interface Embeddings {
  embed(texts: string[], opts?: { signal?: AbortSignal }): Promise<{ vectors: number[][]; usage: Usage; model: string }>
}

export interface SearchResult {
  title: string
  url: string
  snippet: string
  publisher?: string
}

export interface WebResearch {
  search(input: {
    query: string
    maxResults: number
    /** BCP 47 language, e.g. "sv". */
    language: string
    signal?: AbortSignal
  }): Promise<SearchResult[]>
}

// ---- Adapter-level primitive (internal) ----

export type StructuredMode = 'auto' | 'json_schema' | 'json_mode' | 'prompt'

/** One chat round trip. Adapters implement this; the structured/repair logic sits on top. */
export interface ChatRequest {
  system?: string
  messages: (ChatMessage & { images?: ImageInput[] })[]
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
  /** Ask for JSON matching `jsonSchema` (root is always an object). */
  json?: { name: string; jsonSchema: Record<string, unknown>; mode: StructuredMode }
}

export interface ChatResponse {
  text: string
  /** Already-parsed JSON when the provider returned it natively (tool use). */
  json?: unknown
  usage: Usage
  model: string
}

export type ChatFn = (req: ChatRequest) => Promise<ChatResponse>
