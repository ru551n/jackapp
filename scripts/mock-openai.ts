// Tiny OpenAI-compatible server for e2e and the Docker smoke test: /v1/models and /v1/chat/completions.
// Structured requests are answered by the dev mock (server/ai/dev-mock.ts) from response_format's
// json_schema, so the real HTTP adapter path runs end to end. Strict study-material requests get items
// that cite the uploaded segments (the dev mock writes ungrounded addition items).
//   MOCK_AI_PORT=8080 npx tsx scripts/mock-openai.ts
import { createServer } from 'node:http'
import { devMockText } from '../server/ai/dev-mock'

const port = Number(process.env.MOCK_AI_PORT ?? 8080)
const SEGMENT = /^\[([^\]]+)\] \(sida \d+, [^)]+\) (.+)$/gm

type Msg = { role: string; content: string | { type: string; text?: string }[] }

/** Strict source mode: true/false items quoting the longest uploaded segments, each citing its segment. */
function grounded(out: { items: Record<string, unknown>[] }, system: string, kinds: string[]) {
  const segs = [...system.matchAll(SEGMENT)].map((m) => ({ id: m[1]!, text: m[2]!.trim() }))
  if (!segs.length) return out
  segs.sort((a, b) => b.text.length - a.text.length)
  out.items = out.items.map((item, i) => {
    const seg = segs[i % segs.length]!
    if (!kinds.includes('trueFalse')) return { ...item, sourceSegmentIds: [seg.id] }
    return {
      kind: 'trueFalse',
      prompt: `Sant eller falskt: ${seg.text.replace(/[.!?]$/, '')}.`,
      answer: true,
      difficulty: 2,
      skills: item.skills,
      hints: ['Läs texten en gång till.'],
      explanation: `Det står i texten: ${seg.text}`,
      sourceSegmentIds: [seg.id],
    }
  })
  return out
}

function answer(body: { messages?: Msg[]; response_format?: any }): string {
  const text = (m: Msg) => (typeof m.content === 'string' ? m.content : m.content.map((p) => p.text ?? '').join('\n'))
  const messages = (body.messages ?? []).map((m) => ({ role: m.role, content: text(m) }))
  const system = messages.find((m) => m.role === 'system')?.content ?? ''
  const schema = body.response_format?.type === 'json_schema' ? body.response_format.json_schema : undefined
  const req = {
    system,
    messages: messages.filter((m) => m.role !== 'system') as never,
    json: schema && { name: schema.name, jsonSchema: schema.schema, mode: 'json_schema' as const },
  }
  let out = devMockText(req as never, 0) as any
  if (schema?.name === 'artifact_items' && system.includes('Källläge STRIKT')) {
    const items = schema.schema.properties.items.items
    const kinds = (items.anyOf ?? items.oneOf ?? [items]).map((o: any) => o.properties.kind.const)
    out = grounded(out, system, kinds)
  }
  return typeof out === 'string' ? out : JSON.stringify(out)
}

const server = createServer((req, res) => {
  const send = (status: number, json: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(json))
  }
  const path = new URL(req.url ?? '/', 'http://x').pathname
  if (req.method === 'GET' && (path === '/v1/models' || path === '/health'))
    return send(200, { object: 'list', data: [{ id: 'mock', object: 'model', owned_by: 'jackapp' }] })
  if (req.method !== 'POST' || path !== '/v1/chat/completions') return send(404, { error: { message: 'not found' } })
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    try {
      const body = JSON.parse(raw)
      const content = answer(body)
      send(200, {
        id: 'chatcmpl-mock',
        object: 'chat.completion',
        model: body.model ?? 'mock',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: Math.ceil(raw.length / 4), completion_tokens: Math.ceil(content.length / 4) },
      })
    } catch (e) {
      send(400, { error: { message: (e as Error).message } })
    }
  })
})
server.listen(port, '0.0.0.0', () => console.log(`mock-openai listening on :${port}`))
for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => server.close(() => process.exit(0)))
