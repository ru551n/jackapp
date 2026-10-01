import { vi } from 'vitest'

// Tiny fetch mock for component tests: routes keyed "METHOD /path" (path after /api/v1, query ignored
// unless the key contains "?"). A handler returns a body, or { status, body } via `reply`.

type Reply = { __reply: true; status: number; body?: unknown }
export const reply = (status: number, body?: unknown): Reply => ({ __reply: true, status, body })
export const apiError = (status: number, code: string, message = 'Fel.') => reply(status, { error: { code, message } })

type Handler = unknown | ((body: unknown, url: string) => unknown)
export interface Call {
  method: string
  path: string
  body: unknown
}

export function mockApi(routes: Record<string, Handler>) {
  const calls: Call[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input).replace(/^\/api\/v1/, '')
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ method, path: url, body })
    const h = routes[`${method} ${url}`] ?? routes[`${method} ${url.split('?')[0]}`]
    if (h === undefined)
      return new Response(JSON.stringify({ error: { code: 'not_found', message: url } }), { status: 404 })
    let r = typeof h === 'function' ? await (h as (b: unknown, u: string) => unknown)(body, url) : h
    if (!(r && typeof r === 'object' && '__reply' in r)) r = reply(200, r)
    const { status, body: out } = r as Reply
    return status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(out ?? null), { status })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, routes }
}
