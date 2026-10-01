import { z, type ZodType } from 'zod'
import {
  AiError,
  type ChatFn,
  type ChatRequest,
  type GenerateInput,
  type GenerateResult,
  type ImageInput,
  type StructuredInput,
  type StructuredMode,
} from './types'

// Structured output on top of any ChatFn: zod → JSON Schema, validate, one repair round.
// Background: docs/platform/ai-providers.md#adapters-and-structured-output

/** JSON Schema for the provider. Non-object roots are wrapped as { value } (tools/json_schema need objects). */
export function toProviderSchema(schema: ZodType): { jsonSchema: Record<string, unknown>; wrapped: boolean } {
  const { $schema: _, ...js } = z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown>
  if (js.type === 'object') return { jsonSchema: js, wrapped: false }
  return {
    jsonSchema: { type: 'object', properties: { value: js }, required: ['value'], additionalProperties: false },
    wrapped: true,
  }
}

/** Pull a JSON value out of free text (handles ```json fences and surrounding prose). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const s = (fenced ? fenced[1]! : text).trim()
  try {
    return JSON.parse(s)
  } catch {
    const start = s.search(/[{[]/)
    const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'))
    if (start < 0 || end <= start) throw new Error('no JSON found')
    return JSON.parse(s.slice(start, end + 1))
  }
}

export async function generate(
  chat: ChatFn,
  mode: StructuredMode,
  input: (GenerateInput | StructuredInput<unknown>) & { images?: ImageInput[] },
): Promise<GenerateResult<unknown>> {
  const messages: ChatRequest['messages'] = input.messages.map((m) => ({ ...m }))
  if (input.images?.length) {
    const last = messages.findLastIndex((m) => m.role === 'user')
    if (last < 0) throw new AiError('ai_config', { detail: 'vision input needs a user message' })
    messages[last]!.images = input.images
  }
  const base = {
    system: input.system,
    messages,
    maxTokens: input.maxTokens,
    temperature: input.temperature,
    signal: input.signal,
  }
  if (!('schema' in input) || !input.schema) {
    const r = await chat(base)
    return { output: r.text, usage: r.usage, model: r.model }
  }

  const { jsonSchema, wrapped } = toProviderSchema(input.schema)
  const json = { name: input.schemaName ?? 'result', jsonSchema, mode }
  const usage = { inputTokens: 0, outputTokens: 0 }
  let req: ChatRequest = { ...base, json }
  for (let attempt = 0; ; attempt++) {
    const r = await chat(req)
    usage.inputTokens += r.usage.inputTokens
    usage.outputTokens += r.usage.outputTokens
    let problem: string
    try {
      let value = r.json !== undefined ? r.json : extractJson(r.text)
      if (wrapped) value = (value as { value?: unknown })?.value
      const parsed = input.schema.safeParse(value)
      if (parsed.success) return { output: parsed.data, usage, model: r.model }
      problem = z.prettifyError(parsed.error)
    } catch {
      problem = 'Svaret var inte giltig JSON.'
    }
    if (attempt === 1) throw new AiError('ai_invalid_output', { detail: 'validation failed after repair round' })
    // One repair round: show the model its answer and the validation errors.
    req = {
      ...req,
      messages: [
        ...messages,
        { role: 'assistant', content: r.json !== undefined ? JSON.stringify(r.json) : r.text },
        {
          role: 'user',
          content: `Svaret följde inte schemat:\n${problem}\nSvara igen med endast giltig JSON som följer schemat.`,
        },
      ],
    }
  }
}

/** System prompt addition for json_mode/prompt strategies. */
export function schemaInstruction(jsonSchema: Record<string, unknown>) {
  return `Svara endast med ett JSON-objekt (ingen annan text) som följer detta JSON Schema:\n${JSON.stringify(jsonSchema)}`
}
