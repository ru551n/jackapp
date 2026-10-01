import { vi } from 'vitest'

// Test helper: a fetch mock routed by "METHOD /path" (path without /api/v1). Records JSON bodies.

type Handler = (body: unknown) => unknown
export interface Call {
  method: string
  path: string
  body: unknown
}

export function mockApi(routes: Record<string, Handler | unknown>) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const path = url.pathname.replace('/api/v1', '') + url.search
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, path, body })
    const route = routes[`${method} ${path}`] ?? routes[`${method} ${url.pathname.replace('/api/v1', '')}`]
    if (route === undefined)
      return new Response(JSON.stringify({ error: { code: 'not_found', message: 'Hittades inte.' } }), { status: 404 })
    const data = typeof route === 'function' ? (route as Handler)(body) : route
    if (data instanceof Response) return data
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

/** Learner-facing text must never contain the word "fel". */
export const hasFel = () => /\bfel\b/i.test(document.body.textContent ?? '')
