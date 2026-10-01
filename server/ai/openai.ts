import type { ModelCapConfig } from './config'
import { httpJson, httpRaw, joinUrl } from './http'
import { schemaInstruction } from './structured'
import { AiError, type ChatFn, type ChatRequest, type GeneratedImage, type StructuredMode } from './types'

// OpenAI and OpenAI-compatible (llama.cpp, Ollama, vLLM, LM Studio) over plain fetch.

const headers = (c: ModelCapConfig): Record<string, string> => (c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {})

export function openAiChat(c: ModelCapConfig): ChatFn {
  // Compatible servers: auto starts at json_schema and steps down on 400 (remembered per process).
  let compatMode: StructuredMode = 'json_schema'
  const send = async (req: ChatRequest, mode: StructuredMode) => {
    const body: Record<string, unknown> = { model: c.model, messages: toMessages(req, mode) }
    if (req.maxTokens) body[c.provider === 'openai' ? 'max_completion_tokens' : 'max_tokens'] = req.maxTokens
    if (req.temperature !== undefined) body.temperature = req.temperature
    if (req.json && mode === 'json_schema') {
      const name = req.json.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
      const strict = isStrictCompatible(req.json.jsonSchema)
      body.response_format = { type: 'json_schema', json_schema: { name, schema: req.json.jsonSchema, strict } }
    } else if (req.json && mode === 'json_mode') body.response_format = { type: 'json_object' }
    const r = await httpJson(joinUrl(c.baseUrl, '/chat/completions'), {
      body,
      headers: headers(c),
      timeoutMs: c.timeoutMs,
      signal: req.signal,
    })
    const choice = r?.choices?.[0]
    if (choice?.message?.refusal || choice?.finish_reason === 'content_filter')
      throw new AiError('ai_refused', { detail: 'provider refusal' })
    if (typeof choice?.message?.content !== 'string')
      throw new AiError('ai_invalid_output', { detail: 'no message content' })
    return {
      text: choice.message.content as string,
      usage: { inputTokens: r.usage?.prompt_tokens ?? 0, outputTokens: r.usage?.completion_tokens ?? 0 },
      model: (r.model as string) ?? c.model,
    }
  }

  return async (req) => {
    if (!req.json) return send(req, 'prompt')
    const configured = req.json.mode
    if (configured !== 'auto') return send(req, configured)
    if (c.provider !== 'openai-compatible') return send(req, 'json_schema')
    for (;;) {
      const mode = compatMode
      try {
        return await send(req, mode)
      } catch (e) {
        const next = mode === 'json_schema' ? 'json_mode' : mode === 'json_mode' ? 'prompt' : undefined
        if (!(e instanceof AiError && e.status === 400 && next)) throw e
        compatMode = next
      }
    }
  }
}

function toMessages(req: ChatRequest, mode: StructuredMode) {
  let system = req.system ?? ''
  if (req.json && mode !== 'json_schema')
    system = [system, schemaInstruction(req.json.jsonSchema)].filter(Boolean).join('\n\n')
  const out: unknown[] = system ? [{ role: 'system', content: system }] : []
  for (const m of req.messages) {
    if (!m.images?.length) out.push({ role: m.role, content: m.content })
    else
      out.push({
        role: m.role,
        content: [
          { type: 'text', text: m.content },
          ...m.images.map((i) => ({
            type: 'image_url',
            image_url: { url: `data:${i.mimeType};base64,${i.data.toString('base64')}` },
          })),
        ],
      })
  }
  return out
}

/** OpenAI strict mode needs every property required and additionalProperties:false on every object. */
export function isStrictCompatible(s: unknown): boolean {
  if (Array.isArray(s)) return s.every(isStrictCompatible)
  if (!s || typeof s !== 'object') return true
  const o = s as Record<string, unknown>
  if (o.type === 'object' || o.properties) {
    const keys = Object.keys((o.properties as object) ?? {})
    const req = (o.required as string[]) ?? []
    if (o.additionalProperties !== false || keys.some((k) => !req.includes(k))) return false
  }
  return Object.values(o).every(isStrictCompatible)
}

export async function openAiImages(
  c: ModelCapConfig,
  input: { prompt: string; size: string; n: number; signal?: AbortSignal },
): Promise<GeneratedImage[]> {
  const body: Record<string, unknown> = { model: c.model, prompt: input.prompt, size: input.size, n: input.n }
  // gpt-image-* always returns b64 and rejects response_format; DALL·E and compatible servers need it.
  if (!(c.provider === 'openai' && c.model.startsWith('gpt-image'))) body.response_format = 'b64_json'
  const r = await httpJson(joinUrl(c.baseUrl, '/images/generations'), {
    body,
    headers: headers(c),
    timeoutMs: c.timeoutMs,
    signal: input.signal,
  })
  const items: { b64_json?: string; url?: string }[] = r?.data ?? []
  const ok: GeneratedImage[] = []
  for (const d of items) {
    const data = d.b64_json
      ? Buffer.from(d.b64_json, 'base64')
      : d.url
        ? Buffer.from(await (await httpRaw(d.url, { timeoutMs: c.timeoutMs, signal: input.signal })).arrayBuffer())
        : undefined
    const mimeType = data ? sniffImage(data) : ''
    if (data && mimeType) ok.push({ data, mimeType })
  }
  if (!ok.length) throw new AiError('ai_invalid_output', { detail: 'no image data' })
  return ok
}

export function sniffImage(b: Buffer): string {
  if (b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  return ''
}

export async function openAiEmbed(c: ModelCapConfig, texts: string[], signal?: AbortSignal) {
  const r = await httpJson(joinUrl(c.baseUrl, '/embeddings'), {
    body: { model: c.model, input: texts },
    headers: headers(c),
    timeoutMs: c.timeoutMs,
    signal,
  })
  const data: { index: number; embedding: number[] }[] = r?.data ?? []
  if (data.length !== texts.length) throw new AiError('ai_invalid_output', { detail: 'embedding count mismatch' })
  return {
    vectors: [...data].sort((a, b) => a.index - b.index).map((d) => d.embedding),
    usage: { inputTokens: r.usage?.prompt_tokens ?? 0, outputTokens: 0 },
    model: (r.model as string) ?? c.model,
  }
}

export const openAiProbe = (c: ModelCapConfig, timeoutMs: number) =>
  httpRaw(joinUrl(c.baseUrl, '/models'), { headers: headers(c), timeoutMs })
