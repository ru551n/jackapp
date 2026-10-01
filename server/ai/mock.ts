import type { ChatFn, ChatRequest } from './types'

// Deterministic mock provider for tests and local development. Tests script it via MockScripts.

/** Returns raw text (string) or a JSON value (returned as if the provider produced it natively). */
export type MockChatHandler = (req: ChatRequest, call: number) => unknown

export interface MockScripts {
  text?: MockChatHandler
  vision?: MockChatHandler
}

export function mockChat(model: string, handler?: MockChatHandler): ChatFn {
  let call = 0
  return async (req) => {
    req.signal?.throwIfAborted()
    const out = handler ? await handler(req, call++) : req.json ? sample(req.json.jsonSchema) : `Mock-svar (${model}).`
    const text = typeof out === 'string' ? out : JSON.stringify(out)
    return { text, json: typeof out === 'string' ? undefined : out, usage: { inputTokens: 1, outputTokens: 1 }, model }
  }
}

/** Minimal value satisfying a JSON Schema's structural constraints. */
export function sample(s: any): unknown {
  if (!s || typeof s !== 'object') return null
  if ('const' in s) return s.const
  if (s.enum) return s.enum[0]
  // Nullable (model-facing optional) fields: the minimal value is null.
  if (Array.isArray(s.type) && s.type.includes('null')) return null
  const alts = s.anyOf ?? s.oneOf
  if (alts) return alts.some((a: any) => a?.type === 'null') ? null : sample(alts[0])
  const type = Array.isArray(s.type) ? s.type[0] : s.type
  switch (type) {
    case 'object':
      return Object.fromEntries((s.required ?? []).map((k: string) => [k, sample(s.properties?.[k])]))
    case 'array':
      return Array.from({ length: s.minItems ?? 1 }, () => sample(s.items))
    case 'string':
      return 'mock'.padEnd(s.minLength ?? 0, 'x')
    case 'number':
    case 'integer':
      return s.minimum ?? (s.exclusiveMinimum !== undefined ? s.exclusiveMinimum + 1 : 0)
    case 'boolean':
      return false
    default:
      return null
  }
}

/** Deterministic 8-dim vector from the text. */
export function mockEmbedding(text: string): number[] {
  const v = new Array<number>(8).fill(0)
  for (let i = 0; i < text.length; i++) v[i % 8]! += text.charCodeAt(i) / 1000
  return v
}

/** 1×1 transparent PNG. */
export const MOCK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
