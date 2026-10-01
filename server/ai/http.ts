import { AiError } from './types'

// fetch with timeout + AiError classification. Never puts URLs, headers or bodies into errors.

export interface HttpOpts {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: unknown
  timeoutMs: number
  signal?: AbortSignal
}

export async function httpJson<T = any>(url: string, opts: HttpOpts): Promise<T> {
  const res = await httpRaw(url, opts)
  try {
    return (await res.json()) as T
  } catch {
    throw new AiError('ai_unavailable', { detail: 'non-JSON response' })
  }
}

export async function httpRaw(url: string, opts: HttpOpts): Promise<Response> {
  const timeout = AbortSignal.timeout(opts.timeoutMs)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
  let res: Response
  try {
    res = await fetch(url, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers: { ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...opts.headers },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal,
    })
  } catch (e) {
    // Caller cancellation propagates as-is; it is not a provider failure.
    if (opts.signal?.aborted) throw opts.signal.reason
    throw new AiError('ai_unavailable', { detail: timeout.aborted ? 'timeout' : `network: ${(e as Error).name}` })
  }
  if (res.ok) return res
  throw await classify(res)
}

/** Which request parameter a 4xx is about. Matches the message but never stores it (it may echo prompts). */
function rejectedParam(e: any): string | undefined {
  const param = typeof e?.param === 'string' && e.param.length < 64 ? e.param : undefined
  const text = `${param ?? ''} ${typeof e?.message === 'string' ? e.message.slice(0, 500) : ''}`
  if (/\btemperature\b/i.test(text)) return 'temperature'
  if (/response_format|json_schema|json_object|structured output/i.test(text)) return 'response_format'
  return param
}

async function classify(res: Response): Promise<AiError> {
  // Only short machine codes from the provider body; its message may echo prompt content.
  let providerCode = ''
  let param: string | undefined
  let credit = false
  try {
    const b = (await res.json()) as any
    const c = b?.error?.code ?? b?.error?.type ?? b?.type
    if (typeof c === 'string' && c.length < 64) providerCode = ` ${c}`
    param = rejectedParam(b?.error)
    // Anthropic reports a low credit balance as a 400 invalid_request_error.
    credit = typeof b?.error?.message === 'string' && /credit balance/i.test(b.error.message)
  } catch {
    /* body not JSON */
  }
  const s = res.status
  const detail = `HTTP ${s}${providerCode}${param ? ` param=${param}` : ''}`
  if (s === 401 || s === 403) return new AiError('ai_auth', { status: s, detail })
  // An exhausted quota/credit balance is not a temporary rate limit: retrying cannot help.
  if ((s === 429 && /quota|credit|billing/i.test(providerCode)) || (s === 400 && credit))
    return new AiError('ai_config', {
      status: s,
      detail,
      message: 'AI-tjänstens kvot eller krediter är slut. En administratör behöver kontrollera kontot.',
    })
  if (s === 429) {
    const ra = Number(res.headers.get('retry-after'))
    return new AiError('ai_rate_limited', { status: s, detail, retryAfterMs: ra > 0 ? ra * 1000 : undefined })
  }
  if (s >= 500 || s === 408) return new AiError('ai_unavailable', { status: s, detail })
  // Other 4xx: wrong model, unsupported parameter, bad base URL. An admin problem.
  return new AiError('ai_config', { status: s, detail, param })
}

export const joinUrl = (base: string, path: string) => base.replace(/\/+$/, '') + path
