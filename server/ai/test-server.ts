import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

// Local HTTP stand-in for AI providers in tests. No real network or keys.

export interface SeenRequest {
  method: string
  path: string
  headers: Record<string, string | string[] | undefined>
  body: any
}
export interface Reply {
  status?: number
  json?: unknown
  delayMs?: number
}

export async function startMockServer(handler: (req: SeenRequest, n: number) => Reply | Promise<Reply>) {
  const requests: SeenRequest[] = []
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const seen = { method: req.method!, path: req.url!, headers: req.headers, body: raw ? JSON.parse(raw) : undefined }
    requests.push(seen)
    const r = await handler(seen, requests.length - 1)
    if (r.delayMs) await new Promise((ok) => setTimeout(ok, r.delayMs))
    if (res.destroyed) return
    res.writeHead(r.status ?? 200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(r.json ?? {}))
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    url,
    requests,
    close: () => new Promise<void>((ok) => (server.closeAllConnections(), server.close(() => ok()))),
  }
}

export const chatCompletion = (content: string, extra: Record<string, unknown> = {}) => ({
  model: 'test-model',
  choices: [{ message: { role: 'assistant', content, ...extra }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
})

export const silentLog: { info(o: unknown): void; warn(o: unknown): void } = { info: () => {}, warn: () => {} }
