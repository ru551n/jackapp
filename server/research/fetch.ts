import { lookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import type { Readable } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'

// Safe outbound fetcher for untrusted URLs (search results, image hosts). SSRF design and limits:
// docs/platform/research-and-licensing.md#safe-fetcher

export const USER_AGENT = 'JackAppBot/1.0 (self-hosted household learning app; respects robots.txt)'
export const ROBOTS_TOKEN = 'jackappbot'

export class FetchError extends Error {
  readonly code: 'bad_url' | 'blocked_address' | 'dns' | 'redirects' | 'http_status' | 'content_type' | 'too_large'
  constructor(code: FetchError['code'], message: string) {
    super(message)
    this.name = 'FetchError'
    this.code = code
  }
}

export interface ResolvedAddress {
  address: string
  family: 4 | 6
}
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>

export interface SafeFetchOptions {
  /** Allowed MIME types (exact, lowercase), e.g. ['text/html']. */
  accept: string[]
  maxBytes?: number
  timeoutMs?: number
  maxRedirects?: number
  signal?: AbortSignal
  /** DNS hook (tests). Default: system resolver, all addresses. */
  resolve?: Resolver
  /** Address policy hook (tests). Default: isBlockedAddress. */
  isBlocked?: (ip: string) => boolean
}

export interface Fetched {
  /** Final URL after redirects. */
  url: string
  status: number
  contentType: string
  body: Buffer
}

export type Fetcher = (url: string, opts: SafeFetchOptions) => Promise<Fetched>

// Non-public ranges (IANA special-purpose registries). Any match rejects the host.
const blocked = new BlockList()
for (const [net, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(net, bits, 'ipv4')
for (const [net, bits] of [
  ['::', 128],
  ['::1', 128],
  // IPv4-mapped (::ffff:a.b.c.d) is checked against the IPv4 rules by BlockList itself.
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23], // IETF protocol assignments incl. Teredo
  ['2001:db8::', 32],
  ['2002::', 16], // 6to4 (embeds arbitrary IPv4)
  ['fc00::', 7], // ULA
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
] as const)
  blocked.addSubnet(net, bits, 'ipv6')

/** True for loopback, private, link-local, CGNAT, multicast, documentation and other non-public addresses. */
export function isBlockedAddress(ip: string): boolean {
  const v = isIP(ip)
  if (v === 0) return true
  return blocked.check(ip, v === 4 ? 'ipv4' : 'ipv6')
}

const systemResolve: Resolver = async (host) =>
  (await lookup(host, { all: true, verbatim: true })).map((a) => ({ address: a.address, family: a.family as 4 | 6 }))

/** Resolve once and check every address; the request then connects to exactly this address (no rebinding). */
async function pinAddress(hostname: string, o: SafeFetchOptions): Promise<ResolvedAddress> {
  const isBlocked = o.isBlocked ?? isBlockedAddress
  const host = hostname.replace(/^\[|\]$/g, '')
  const literal = isIP(host)
  let addrs: ResolvedAddress[]
  if (literal) addrs = [{ address: host, family: literal as 4 | 6 }]
  else {
    try {
      addrs = await (o.resolve ?? systemResolve)(host)
    } catch {
      throw new FetchError('dns', `cannot resolve ${host}`)
    }
  }
  if (!addrs.length) throw new FetchError('dns', `no address for ${host}`)
  if (addrs.some((a) => isBlocked(a.address))) throw new FetchError('blocked_address', `non-public address for ${host}`)
  return addrs[0]!
}

function request(url: URL, addr: ResolvedAddress, signal: AbortSignal) {
  const mod = url.protocol === 'https:' ? https : http
  return new Promise<http.IncomingMessage>((resolve, reject) => {
    const req = mod.request(url, {
      method: 'GET',
      signal,
      headers: { 'user-agent': USER_AGENT, accept: '*/*', 'accept-encoding': 'gzip, deflate, br' },
      // Hand the pre-checked address to the socket; Node calls this instead of DNS.
      lookup: ((_h: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) =>
        opts?.all ? cb(null, [addr]) : cb(null, addr.address, addr.family)) as LookupFunction,
    })
    req.on('response', resolve)
    req.on('error', reject)
    req.end()
  })
}

const decoders: Record<string, () => NodeJS.ReadWriteStream> = {
  gzip: createGunzip,
  'x-gzip': createGunzip,
  deflate: createInflate,
  br: createBrotliDecompress,
}

async function readCapped(res: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers['content-length'])
  if (declared > maxBytes) throw new FetchError('too_large', 'response too large')
  const enc = String(res.headers['content-encoding'] ?? 'identity').toLowerCase()
  const decode = decoders[enc]
  if (!decode && enc !== 'identity') throw new FetchError('content_type', `unsupported encoding ${enc}`)
  // Cap counts decoded bytes, so compression bombs stop at maxBytes too.
  const stream: Readable = decode ? (res.pipe(decode()) as unknown as Readable) : res
  const chunks: Buffer[] = []
  let n = 0
  try {
    for await (const chunk of stream) {
      n += chunk.length
      if (n > maxBytes) throw new FetchError('too_large', 'response too large')
      chunks.push(chunk)
    }
  } finally {
    res.destroy()
  }
  return Buffer.concat(chunks)
}

/** GET an untrusted URL with SSRF protection, redirect/size/time limits and a content-type allowlist. */
export const safeFetch: Fetcher = async (input, o) => {
  const maxRedirects = o.maxRedirects ?? 5
  const signal = AbortSignal.any([AbortSignal.timeout(o.timeoutMs ?? 10_000), ...(o.signal ? [o.signal] : [])])
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new FetchError('bad_url', 'invalid url')
  }
  for (let hop = 0; ; hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchError('bad_url', 'only http(s)')
    if (url.username || url.password) throw new FetchError('bad_url', 'credentials in url')
    const res = await request(url, await pinAddress(url.hostname, o), signal)
    const status = res.statusCode ?? 0
    if (status >= 300 && status < 400 && res.headers.location) {
      res.destroy()
      if (hop >= maxRedirects) throw new FetchError('redirects', 'too many redirects')
      url = new URL(res.headers.location, url)
      continue
    }
    if (status < 200 || status >= 300) {
      res.destroy()
      throw new FetchError('http_status', `HTTP ${status}`)
    }
    const contentType = String(res.headers['content-type'] ?? '')
      .split(';')[0]!
      .trim()
      .toLowerCase()
    if (!o.accept.includes(contentType)) {
      res.destroy()
      throw new FetchError('content_type', `content type ${contentType || 'missing'} not allowed`)
    }
    return { url: url.href, status, contentType, body: await readCapped(res, o.maxBytes ?? 2 * 1024 * 1024) }
  }
}

// ---- robots.txt (RFC 9309 subset) ----

interface Rule {
  allow: boolean
  pattern: string
}

/** Rules for our token, else for `*`. Supports Allow/Disallow, `*` and `$`; longest match wins, Allow wins ties. */
export function parseRobots(txt: string, token = ROBOTS_TOKEN): Rule[] {
  const groups: { agents: string[]; rules: Rule[] }[] = []
  let cur: { agents: string[]; rules: Rule[] } | undefined
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line)
    if (!m) continue
    const key = m[1]!.toLowerCase()
    const value = m[2]!.trim()
    if (key === 'user-agent') {
      if (!cur || cur.rules.length) groups.push((cur = { agents: [], rules: [] }))
      cur.agents.push(value.toLowerCase())
    } else if ((key === 'allow' || key === 'disallow') && cur) {
      if (value.length > MAX_PATTERN) {
        // Cut a long Disallow (blocks more); drop a long Allow (would allow more).
        if (key === 'disallow') cur.rules.push({ allow: false, pattern: value.slice(0, MAX_PATTERN) })
      } else if (value) cur.rules.push({ allow: key === 'allow', pattern: value })
      else cur.rules.push({ allow: true, pattern: '' }) // "Disallow:" = allow all; keeps the group non-empty
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && token.startsWith(a)))
  return (mine.length ? mine : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules)
}

/** Robots.txt patterns longer than this are cut (Disallow) or ignored (Allow). */
const MAX_PATTERN = 512

/** `*`/`$` wildcard match against a path prefix without regex backtracking (greedy leftmost, linear scans). */
export function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith('$')
  const parts = (anchored ? pattern.slice(0, -1) : pattern).split('*')
  const first = parts[0]!
  if (!path.startsWith(first)) return false
  if (parts.length === 1) return !anchored || path.length === first.length
  let pos = first.length
  const last = parts.length - 1
  for (let i = 1; i < last; i++) {
    const at = path.indexOf(parts[i]!, pos)
    if (at < 0) return false
    pos = at + parts[i]!.length
  }
  const tail = parts[last]!
  if (anchored) return path.length - tail.length >= pos && path.endsWith(tail)
  return path.indexOf(tail, pos) >= 0
}

export function robotsAllows(rules: Rule[], pathAndQuery: string): boolean {
  let best: Rule | undefined
  for (const r of rules) {
    if (!r.pattern || !matches(r.pattern, pathAndQuery)) continue
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow))
      best = r
  }
  return best?.allow ?? true
}

/**
 * Per-run robots.txt checker. 4xx → allowed (no robots.txt); unreachable/5xx → disallowed,
 * as RFC 9309 asks. Cached per origin for the checker's lifetime.
 */
export function robotsChecker(fetcher: Fetcher, base: Omit<SafeFetchOptions, 'accept'>) {
  const cache = new Map<string, Promise<Rule[] | null>>()
  return async (target: string): Promise<boolean> => {
    const u = new URL(target)
    let rules = cache.get(u.origin)
    if (!rules) {
      rules = fetcher(`${u.origin}/robots.txt`, { ...base, accept: ['text/plain'], maxBytes: 512 * 1024 })
        .then((r) => parseRobots(r.body.toString('utf8')))
        .catch((e) => {
          if (e instanceof FetchError && e.code === 'http_status' && /HTTP 4\d\d/.test(e.message)) return []
          if (e instanceof FetchError && e.code === 'content_type') return [] // HTML 200 "robots" pages: no rules
          return null
        })
      cache.set(u.origin, rules)
    }
    const r = await rules
    return r !== null && robotsAllows(r, u.pathname + u.search)
  }
}
