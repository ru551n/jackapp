import type { ModelCapConfig } from './config'
import { httpJson, httpRaw, joinUrl } from './http'
import { schemaInstruction } from './structured'
import { AiError, type ChatFn } from './types'

// Anthropic Messages API (and compatible endpoints) over plain fetch.
// Structured output: forced tool use with input_schema (auto/json_schema); json_mode/prompt = schema in system prompt.

const root = (c: ModelCapConfig) => c.baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')
const headers = (c: ModelCapConfig): Record<string, string> => ({
  'anthropic-version': '2023-06-01',
  ...(c.apiKey ? { 'x-api-key': c.apiKey } : {}),
})

export function anthropicChat(c: ModelCapConfig): ChatFn {
  return async (req) => {
    const useTool = !!req.json && (req.json.mode === 'auto' || req.json.mode === 'json_schema')
    let system = req.system ?? ''
    if (req.json && !useTool) system = [system, schemaInstruction(req.json.jsonSchema)].filter(Boolean).join('\n\n')
    const toolName = req.json?.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
    const body: Record<string, unknown> = {
      model: c.model,
      max_tokens: req.maxTokens ?? 4096,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.images?.length
          ? [
              ...m.images.map((i) => ({
                type: 'image',
                source: { type: 'base64', media_type: i.mimeType, data: i.data.toString('base64') },
              })),
              { type: 'text', text: m.content },
            ]
          : m.content,
      })),
    }
    if (system) body.system = system
    if (req.temperature !== undefined) body.temperature = req.temperature
    if (useTool) {
      body.tools = [{ name: toolName, description: 'Lämna svaret.', input_schema: req.json!.jsonSchema }]
      body.tool_choice = { type: 'tool', name: toolName }
    }
    const r = await httpJson(joinUrl(root(c), '/v1/messages'), {
      body,
      headers: headers(c),
      timeoutMs: c.timeoutMs,
      signal: req.signal,
    })
    if (r?.stop_reason === 'refusal') throw new AiError('ai_refused', { detail: 'provider refusal' })
    const content: { type: string; text?: string; input?: unknown }[] = r?.content ?? []
    const tool = content.find((b) => b.type === 'tool_use')
    return {
      text: content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join(''),
      json: useTool && tool ? tool.input : undefined,
      usage: { inputTokens: r.usage?.input_tokens ?? 0, outputTokens: r.usage?.output_tokens ?? 0 },
      model: (r.model as string) ?? c.model,
    }
  }
}

export const anthropicProbe = (c: ModelCapConfig, timeoutMs: number) =>
  httpRaw(joinUrl(root(c), '/v1/models'), { headers: headers(c), timeoutMs })
