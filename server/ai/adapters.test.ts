import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createTestDb, type DbHandle } from '../db/client'
import { AiError, createAi } from './index'
import { MOCK_PNG } from './mock'
import { chatCompletion, type Reply, type SeenRequest, silentLog, startMockServer } from './test-server'

// Provider adapters against local mock HTTP servers. No real keys or network.

const Exercise = z.object({ question: z.string().min(1), answer: z.number() })
const KEY = 'sk-test-SECRET'
let handle: DbHandle
let server: Awaited<ReturnType<typeof startMockServer>> | undefined

beforeAll(async () => {
  handle = await createTestDb()
})
afterAll(async () => handle.close())
afterEach(async () => {
  await server?.close()
  server = undefined
})

async function aiWith(
  env: Record<string, string>,
  handler: (r: SeenRequest, n: number) => Reply | Promise<Reply>,
  log = silentLog,
) {
  server = await startMockServer(handler)
  const filled = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v.replace('$URL', server!.url)]))
  return createAi(filled, { db: handle.db, log })
}
const openai = { AI_TEXT_PROVIDER: 'openai', AI_TEXT_BASE_URL: '$URL/v1', AI_TEXT_API_KEY: KEY, AI_TEXT_MODEL: 'gpt-x' }
const compat = { AI_TEXT_PROVIDER: 'openai-compatible', AI_TEXT_BASE_URL: '$URL/v1', AI_TEXT_MODEL: 'qwen' }
const anthropic = {
  AI_TEXT_PROVIDER: 'anthropic',
  AI_TEXT_BASE_URL: '$URL',
  AI_TEXT_API_KEY: KEY,
  AI_TEXT_MODEL: 'claude-x',
}
const ask = { system: 'Du är lärare.', messages: [{ role: 'user' as const, content: 'Gör en uppgift' }] }

const caught = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e as AiError
  }
  throw new Error('expected rejection')
}

describe('OpenAI', () => {
  it('uses strict json_schema and parses the result', async () => {
    const ai = await aiWith(openai, () => ({ json: chatCompletion('{"question":"1+1?","answer":2}') }))
    const r = await ai.text!.generate({ ...ask, schema: Exercise, schemaName: 'exercise' })
    expect(r.output).toEqual({ question: '1+1?', answer: 2 })
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5 })
    const req = server!.requests[0]!
    expect(req.path).toBe('/v1/chat/completions')
    expect(req.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(req.body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'exercise', strict: true },
    })
    expect(req.body.messages[0]).toEqual({ role: 'system', content: 'Du är lärare.' })
  })

  it('returns plain text without a schema', async () => {
    const ai = await aiWith(openai, () => ({ json: chatCompletion('Hej!') }))
    expect((await ai.text!.generate(ask)).output).toBe('Hej!')
    expect(server!.requests[0]!.body.response_format).toBeUndefined()
  })

  it('runs one repair round with the validation errors', async () => {
    const ai = await aiWith(openai, (_r, n) => ({
      json: chatCompletion(n === 0 ? '{"question":"","answer":"två"}' : '{"question":"1+1?","answer":2}'),
    }))
    const r = await ai.text!.generate({ ...ask, schema: Exercise })
    expect(r.output.answer).toBe(2)
    expect(r.usage).toEqual({ inputTokens: 20, outputTokens: 10 })
    const msgs = server!.requests[1]!.body.messages
    expect(msgs.at(-2)).toMatchObject({ role: 'assistant', content: '{"question":"","answer":"två"}' })
    expect(msgs.at(-1).content).toMatch(/answer/)
  })

  it('fails with ai_invalid_output when the repair round is also malformed', async () => {
    const ai = await aiWith(openai, () => ({ json: chatCompletion('not json at all') }))
    const e = await caught(ai.text!.generate({ ...ask, schema: Exercise }))
    expect(e).toBeInstanceOf(AiError)
    expect(e.code).toBe('ai_invalid_output')
    expect(server!.requests).toHaveLength(2)
  })

  it('wraps non-object schemas and classifies refusals', async () => {
    const ai = await aiWith(openai, (_r, n) => ({
      json: n === 0 ? chatCompletion('{"value":["a","b"]}') : chatCompletion('', { refusal: 'Nej.' }),
    }))
    expect((await ai.text!.generate({ ...ask, schema: z.array(z.string()) })).output).toEqual(['a', 'b'])
    expect(server!.requests[0]!.body.response_format.json_schema.schema.required).toEqual(['value'])
    expect((await caught(ai.text!.generate(ask))).code).toBe('ai_refused')
  })

  it('classifies HTTP errors, timeouts and caller aborts', async () => {
    const statuses: Reply[] = [
      { status: 401, json: { error: { code: 'invalid_api_key', message: 'echo: Gör en uppgift' } } },
      { status: 429 },
      { status: 500 },
      { status: 404 },
    ]
    const ai = await aiWith({ ...openai, AI_TEXT_TIMEOUT_MS: '200' }, (_r, n) => statuses[n] ?? { delayMs: 1000 })
    const auth = await caught(ai.text!.generate(ask))
    expect(auth).toMatchObject({ code: 'ai_auth', retryable: false, detail: 'HTTP 401 invalid_api_key' })
    expect(JSON.stringify({ ...auth, m: auth.message })).not.toContain('Gör en uppgift')
    expect(await caught(ai.text!.generate(ask))).toMatchObject({ code: 'ai_rate_limited', retryable: true })
    expect(await caught(ai.text!.generate(ask))).toMatchObject({ code: 'ai_unavailable', retryable: true })
    expect(await caught(ai.text!.generate(ask))).toMatchObject({ code: 'ai_config', retryable: false })
    expect(await caught(ai.text!.generate(ask))).toMatchObject({ code: 'ai_unavailable', detail: 'timeout' })
    const ctl = new AbortController()
    setTimeout(() => ctl.abort(), 20)
    const aborted = await caught(ai.text!.generate({ ...ask, signal: ctl.signal }))
    expect(aborted).not.toBeInstanceOf(AiError)
    expect((aborted as Error).name).toBe('AbortError')
  })

  it('treats an exhausted quota as a non-retryable admin problem, not a rate limit', async () => {
    const ai = await aiWith(openai, () => ({ status: 429, json: { error: { code: 'credit_balance_exhausted' } } }))
    const err = await caught(ai.text!.generate(ask))
    expect(err).toMatchObject({ code: 'ai_config', retryable: false, detail: 'HTTP 429 credit_balance_exhausted' })
    expect(err.message).toMatch(/kvot eller krediter/)
  })

  it('never logs prompts or keys', async () => {
    const lines: unknown[] = []
    const log = { info: (o: unknown) => lines.push(o), warn: (o: unknown) => lines.push(o) }
    const ai = await aiWith(openai, (_r, n) => (n === 0 ? { json: chatCompletion('ok') } : { status: 401 }), log)
    await ai.text!.generate(ask)
    await caught(ai.text!.generate(ask))
    const s = JSON.stringify(lines)
    expect(s).toContain('"model":"gpt-x"')
    expect(s).toContain('"error":"ai_auth"')
    expect(s).not.toMatch(/Gör en uppgift|lärare|SECRET|127\.0\.0\.1/)
  })
})

describe('OpenAI strict schemas and reasoning models', () => {
  const sent = async (schema: z.ZodType) => {
    const ai = await aiWith(openai, () => ({ json: chatCompletion('{}') }))
    await caught(ai.text!.generate({ ...ask, schema, schemaName: 's' }))
    return server!.requests[0]!.body.response_format.json_schema
  }
  const keywords = (s: unknown): string[] =>
    !s || typeof s !== 'object'
      ? []
      : Array.isArray(s)
        ? s.flatMap(keywords)
        : Object.entries(s).flatMap(([k, v]) => [k, ...keywords(v)])
  const BANNED = ['minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum', 'oneOf', 'pattern', 'default']

  it.each([
    [
      'artifact_texts',
      z.object({ title: z.string().min(1).max(200), bodies: z.array(z.string().min(1).max(12000)).min(2).max(2) }),
    ],
    [
      'study_material',
      z.object({
        language: z.string().min(2).max(5),
        subjectCode: z.string().nullable(),
        topic: z.string().min(1).max(200),
        concepts: z.array(z.string().min(1).max(120)).max(60),
        curriculumRefs: z.array(z.number().int().min(0)).max(20),
      }),
    ],
    [
      'free_text_assessment',
      z.object({
        keyPointsMet: z.array(z.number().int().min(0)).max(8),
        feedback: z.string().min(1).max(300),
        score: z.number().min(0).max(1),
      }),
    ],
    [
      'research_brief',
      z
        .object({
          summary: z.string().min(1).max(1500),
          keyPoints: z
            .array(
              z.object({ text: z.string().min(1).max(300), sources: z.array(z.number().int().min(1)).min(1) }).strict(),
            )
            .min(1)
            .max(10),
        })
        .strict(),
    ],
    ['factual_review', z.object({ flags: z.array(z.object({ itemId: z.string(), problem: z.string() })).max(60) })],
    [
      'discriminated union',
      z.object({
        items: z.array(
          z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('a'), x: z.string().max(5) }),
            z.object({ kind: z.literal('b'), y: z.number().min(0) }),
          ]),
        ),
      }),
    ],
  ])('%s is sent strict with only supported keywords', async (_name, schema) => {
    const js = await sent(schema)
    expect(js.strict).toBe(true)
    const used = keywords(js.schema)
    for (const k of BANNED) expect(used).not.toContain(k)
  })

  it('keeps optional-field schemas non-strict and untouched', async () => {
    const js = await sent(z.object({ a: z.string().min(1), b: z.string().optional() }))
    expect(js.strict).toBe(false)
    expect(js.schema.properties.a.minLength).toBe(1)
  })

  it('retries without temperature once and remembers it', async () => {
    const ai = await aiWith(openai, (r) =>
      'temperature' in r.body
        ? {
            status: 400,
            json: {
              error: { message: "Unsupported value: 'temperature'", param: 'temperature', code: 'unsupported_value' },
            },
          }
        : { json: chatCompletion('ok') },
    )
    expect((await ai.text!.generate({ ...ask, temperature: 0 })).output).toBe('ok')
    expect((await ai.text!.generate({ ...ask, temperature: 0 })).output).toBe('ok')
    expect(server!.requests.map((r) => 'temperature' in r.body)).toEqual([true, false, false])
  })

  it('treats finish_reason length as truncation and retries once with a doubled limit', async () => {
    const truncated = { json: { choices: [{ message: { content: '{"quest' }, finish_reason: 'length' }] } }
    const ai = await aiWith(openai, (_r, n) =>
      n === 0 || n >= 2 ? truncated : { json: chatCompletion('{"question":"q","answer":1}') },
    )
    expect((await ai.text!.generate({ ...ask, schema: Exercise, maxTokens: 500 })).output.answer).toBe(1)
    expect(server!.requests.map((r) => r.body.max_completion_tokens)).toEqual([500, 1000])
    const e = await caught(ai.text!.generate({ ...ask, schema: Exercise, maxTokens: 500 }))
    expect(e).toMatchObject({ code: 'ai_invalid_output', truncated: true })
    // No repair round with the same limit: exactly one doubled retry.
    expect(server!.requests.slice(2).map((r) => r.body.max_completion_tokens)).toEqual([500, 1000])
  })
})

describe('OpenAI-compatible', () => {
  it('falls back json_schema → json_object → prompt and remembers it', async () => {
    const unsupported = { status: 400, json: { error: { message: "'response_format' is not supported" } } }
    const ai = await aiWith(compat, (r) =>
      r.body.response_format
        ? unsupported
        : { json: chatCompletion('Här:\n```json\n{"question":"q","answer":1}\n```') },
    )
    expect((await ai.text!.generate({ ...ask, schema: Exercise })).output).toEqual({ question: 'q', answer: 1 })
    const types = server!.requests.map((r) => r.body.response_format?.type)
    expect(types).toEqual(['json_schema', 'json_object', undefined])
    expect(server!.requests[2]!.body.messages[0].content).toMatch(/JSON Schema/)
    expect(server!.requests[2]!.headers.authorization).toBeUndefined()
    await ai.text!.generate({ ...ask, schema: Exercise })
    expect(server!.requests).toHaveLength(4)
  })

  it('does not downgrade on a 400 unrelated to response_format', async () => {
    const ai = await aiWith(compat, (_r, n) =>
      n === 0
        ? { status: 400, json: { error: { code: 'context_length_exceeded', message: 'too long' } } }
        : { json: chatCompletion('{"question":"q","answer":1}') },
    )
    expect((await caught(ai.text!.generate({ ...ask, schema: Exercise }))).code).toBe('ai_config')
    await ai.text!.generate({ ...ask, schema: Exercise })
    expect(server!.requests.map((r) => r.body.response_format?.type)).toEqual(['json_schema', 'json_schema'])
  })

  it('honours an explicit structured mode', async () => {
    const ai = await aiWith({ ...compat, AI_TEXT_STRUCTURED: 'json_mode' }, () => ({
      json: chatCompletion('{"question":"q","answer":1}'),
    }))
    await ai.text!.generate({ ...ask, schema: Exercise })
    expect(server!.requests[0]!.body.response_format).toEqual({ type: 'json_object' })
    expect(server!.requests[0]!.body.max_tokens).toBeUndefined()
  })
})

describe('Anthropic', () => {
  const toolReply = (input: unknown): Reply => ({
    json: {
      model: 'claude-x',
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 't1', name: 'exercise', input }],
      usage: { input_tokens: 7, output_tokens: 3 },
    },
  })

  it('uses forced tool use and repairs invalid tool input', async () => {
    const ai = await aiWith(anthropic, (_r, n) => toolReply(n === 0 ? { question: 'q' } : { question: 'q', answer: 3 }))
    const r = await ai.text!.generate({ ...ask, schema: Exercise, schemaName: 'exercise' })
    expect(r.output).toEqual({ question: 'q', answer: 3 })
    const req = server!.requests[0]!
    expect(req.path).toBe('/v1/messages')
    expect(req.headers['x-api-key']).toBe(KEY)
    expect(req.headers['anthropic-version']).toBe('2023-06-01')
    expect(req.body.tool_choice).toEqual({ type: 'tool', name: 'exercise' })
    expect(req.body.tools[0].input_schema.required).toEqual(['question', 'answer'])
    expect(req.body.system).toBe('Du är lärare.')
    expect(server!.requests).toHaveLength(2)
  })

  it('sends vision images as base64 blocks; refusal is typed', async () => {
    const env = {
      ...anthropic,
      AI_VISION_PROVIDER: 'anthropic-compatible',
      AI_VISION_BASE_URL: '$URL/v1',
      AI_VISION_MODEL: 'v',
    }
    const ai = await aiWith(env, (_r, n) =>
      n === 0
        ? { json: { content: [{ type: 'text', text: 'En bild.' }], usage: { input_tokens: 1, output_tokens: 1 } } }
        : { json: { stop_reason: 'refusal', content: [] } },
    )
    const r = await ai.vision!.generate({ ...ask, images: [{ data: MOCK_PNG, mimeType: 'image/png' }] })
    expect(r.output).toBe('En bild.')
    const content = server!.requests[0]!.body.messages[0].content
    expect(content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png' } })
    expect(content[1]).toEqual({ type: 'text', text: 'Gör en uppgift' })
    expect(server!.requests[0]!.path).toBe('/v1/messages')
    const e = await caught(ai.vision!.generate({ ...ask, images: [{ data: MOCK_PNG, mimeType: 'image/png' }] }))
    expect(e.code).toBe('ai_refused')
  })
})

describe('Anthropic errors and limits', () => {
  it.each([
    [401, { type: 'error', error: { type: 'authentication_error', message: 'x' } }, 'ai_auth', false],
    [429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, 'ai_rate_limited', true],
    [529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 'ai_unavailable', true],
    [
      400,
      { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low' } },
      'ai_config',
      false,
    ],
  ])('HTTP %i is classified', async (status, json, code, retryable) => {
    const ai = await aiWith(anthropic, () => ({ status, json }))
    const e = await caught(ai.text!.generate(ask))
    expect(e).toMatchObject({ code, retryable })
    if (status === 400) expect(e.message).toMatch(/krediter/)
  })

  it('returns text without a schema and sends no tools', async () => {
    const ai = await aiWith(anthropic, () => ({
      json: { content: [{ type: 'text', text: 'Hej!' }], usage: { input_tokens: 1, output_tokens: 1 } },
    }))
    expect((await ai.text!.generate(ask)).output).toBe('Hej!')
    expect(server!.requests[0]!.body.tools).toBeUndefined()
    expect(server!.requests[0]!.body.max_tokens).toBe(4096)
  })

  it('passes maxTokens through and retries max_tokens truncation with a doubled limit', async () => {
    const ai = await aiWith(anthropic, (_r, n) => ({
      json: {
        stop_reason: n === 0 ? 'max_tokens' : 'tool_use',
        content: [{ type: 'tool_use', id: 't', name: 'r', input: n === 0 ? {} : { question: 'q', answer: 1 } }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    }))
    await ai.text!.generate({ ...ask, schema: Exercise, maxTokens: 6000 })
    expect(server!.requests.map((r) => r.body.max_tokens)).toEqual([6000, 12000])
  })
})

describe('images, embeddings, research', () => {
  it('generates images (b64_json) and embeddings', async () => {
    const env = {
      AI_IMAGE_PROVIDER: 'openai-compatible',
      AI_IMAGE_BASE_URL: '$URL/v1',
      AI_IMAGE_MODEL: 'sd',
      AI_EMBEDDING_PROVIDER: 'openai-compatible',
      AI_EMBEDDING_BASE_URL: '$URL/v1',
      AI_EMBEDDING_MODEL: 'e5',
    }
    const ai = await aiWith(env, (r) =>
      r.path.endsWith('/images/generations')
        ? { json: { data: [{ b64_json: MOCK_PNG.toString('base64') }] } }
        : {
            json: {
              data: [
                { index: 1, embedding: [2] },
                { index: 0, embedding: [1] },
              ],
              usage: { prompt_tokens: 4 },
            },
          },
    )
    const img = await ai.image!.generate({ prompt: 'en katt', size: '512x512', n: 1 })
    expect(img.images[0]).toEqual({ data: MOCK_PNG, mimeType: 'image/png' })
    expect(server!.requests[0]!.body).toMatchObject({ response_format: 'b64_json', size: '512x512', n: 1 })
    expect((await ai.embedding!.embed(['a', 'b'])).vectors).toEqual([[1], [2]])
  })

  it('mock providers are deterministic', async () => {
    const ai = createAi(
      {
        AI_TEXT_PROVIDER: 'mock',
        AI_IMAGE_PROVIDER: 'mock',
        AI_EMBEDDING_PROVIDER: 'mock',
        AI_RESEARCH_PROVIDER: 'mock',
      },
      { db: handle.db, log: silentLog },
    )
    const r = await ai.text!.generate({
      ...ask,
      schema: z.object({ items: z.array(z.string()).min(2), n: z.number().min(3) }),
    })
    expect(r.output).toEqual({ items: ['mock', 'mock'], n: 3 })
    expect((await ai.image!.generate({ prompt: 'x', size: '1x1', n: 2 })).images).toHaveLength(2)
    expect((await ai.embedding!.embed(['abc'])).vectors).toEqual((await ai.embedding!.embed(['abc'])).vectors)
    expect(await ai.research!.search({ query: 'q', maxResults: 3, language: 'sv' })).toHaveLength(1)
  })

  it.each([
    [
      'searxng',
      { AI_RESEARCH_BASE_URL: '$URL' },
      { results: [{ title: 'T', url: 'https://a.se', content: '<b>S</b>' }] },
      (r: SeenRequest) => expect(r.path).toMatch(/^\/search\?q=valar&format=json&language=sv/),
    ],
    [
      'brave',
      { AI_RESEARCH_BASE_URL: '$URL', AI_RESEARCH_API_KEY: KEY },
      { web: { results: [{ title: 'T', url: 'https://a.se', description: 'S', profile: { name: 'P' } }] } },
      (r: SeenRequest) => expect(r.headers['x-subscription-token']).toBe(KEY),
    ],
    [
      'tavily',
      { AI_RESEARCH_BASE_URL: '$URL', AI_RESEARCH_API_KEY: KEY },
      {
        results: [
          { title: 'T', url: 'https://a.se', content: 'S' },
          { title: 'T2', url: 'https://b.se', content: '' },
        ],
      },
      (r: SeenRequest) => expect(r.body).toEqual({ query: 'valar', max_results: 1 }),
    ],
  ])('searches with %s', async (provider, env, json, check) => {
    const ai = await aiWith({ AI_RESEARCH_PROVIDER: provider, ...env }, () => ({ json }))
    const res = await ai.research!.search({ query: 'valar', maxResults: 1, language: 'sv' })
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({ title: 'T', url: 'https://a.se', snippet: 'S' })
    check(server!.requests[0]!)
  })
})
