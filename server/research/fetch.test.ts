import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FetchError,
  isBlockedAddress,
  parseRobots,
  matches,
  robotsAllows,
  robotsChecker,
  safeFetch,
  USER_AGENT,
  type SafeFetchOptions,
} from './fetch'

// Local server stands in for "the public internet": tests resolve *.test to 127.0.0.1 and treat
// only 127.0.0.1 as public. Everything else uses the real (default) address policy.

type Handler = (req: IncomingMessage, res: ServerResponse) => void
let closeServer: (() => Promise<void>) | undefined
afterEach(async () => {
  await closeServer?.()
  closeServer = undefined
})

export async function serve(handler: Handler) {
  const hits: string[] = []
  const server = createServer((req, res) => {
    hits.push(req.url!)
    handler(req, res)
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  const port = (server.address() as AddressInfo).port
  closeServer = () => new Promise<void>((ok) => (server.closeAllConnections(), server.close(() => ok())))
  return { port, hits, base: `http://pub.test:${port}` }
}

export const testNet: Omit<SafeFetchOptions, 'accept'> = {
  resolve: async () => [{ address: '127.0.0.1', family: 4 }],
  isBlocked: (ip) => ip !== '127.0.0.1',
}
const html = { ...testNet, accept: ['text/html'] }

const code = (p: Promise<unknown>) =>
  p.then(
    () => 'ok',
    (e) => (e instanceof FetchError ? e.code : e?.name),
  )

describe('address policy', () => {
  it('blocks loopback, private, link-local, CGNAT, ULA, mapped and special ranges', () => {
    for (const ip of [
      '127.0.0.1',
      '127.8.9.10',
      '0.0.0.0',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '224.0.0.1',
      '255.255.255.255',
      '::',
      '::1',
      'fd00::1',
      'fc00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '64:ff9b::7f00:1',
      '2002:7f00:1::',
      'ff02::1',
      'not-an-ip',
    ])
      expect(isBlockedAddress(ip), ip).toBe(true)
    for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111', '2a00:1450:4001::1'])
      expect(isBlockedAddress(ip), ip).toBe(false)
  })
})

describe('safeFetch SSRF protection', () => {
  it('rejects private targets before connecting (literal IPs, localhost, mixed DNS answers)', async () => {
    const s = await serve((_q, r) => r.end('hi'))
    const real = { accept: ['text/html'], timeoutMs: 2000 }
    for (const url of [
      `http://127.0.0.1:${s.port}/`,
      `http://localhost:${s.port}/`,
      `http://2130706433:${s.port}/`, // decimal 127.0.0.1
      `http://0x7f.1:${s.port}/`,
      'http://10.1.2.3/',
      'http://192.168.0.10/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
      'http://[fd12:3456::1]/',
      'http://[::ffff:127.0.0.1]/',
    ])
      expect(await code(safeFetch(url, real)), url).toBe('blocked_address')
    const mixed = {
      ...real,
      resolve: async () => [
        { address: '93.184.216.34', family: 4 as const },
        { address: '10.0.0.5', family: 4 as const },
      ],
    }
    expect(await code(safeFetch('http://mixed.test/', mixed))).toBe('blocked_address')
    for (const url of ['file:///etc/passwd', 'ftp://example.org/', 'http://user:pw@pub.test/', 'nonsense'])
      expect(await code(safeFetch(url, html)), url).toBe('bad_url')
    expect(s.hits).toEqual([])
  })

  it('connects to the address it checked (DNS rebinding cannot swap it)', async () => {
    const s = await serve((_q, r) => (r.setHeader('content-type', 'text/html'), r.end('ok')))
    let calls = 0
    // First answer is "public" (127.0.0.1 in this test net); any later answer would be private.
    const rebinding = {
      ...html,
      resolve: async () => [{ address: calls++ === 0 ? '127.0.0.1' : '10.0.0.1', family: 4 as const }],
    }
    const r = await safeFetch(`${s.base}/page`, rebinding)
    expect(r.body.toString()).toBe('ok')
    expect(calls).toBe(1)
    // Reverse order: the checked (private) answer is what counts, even if a re-resolve would be public.
    calls = 0
    const flipped = {
      ...html,
      resolve: async () => [{ address: calls++ === 0 ? '10.0.0.1' : '127.0.0.1', family: 4 as const }],
    }
    expect(await code(safeFetch(`${s.base}/page`, flipped))).toBe('blocked_address')
    expect(s.hits).toEqual(['/page'])
  })

  it('re-checks every redirect hop and limits redirects', async () => {
    const s = await serve((q, r) => {
      if (q.url === '/to-private') r.writeHead(302, { location: 'http://10.0.0.1/admin' }).end()
      else if (q.url === '/to-file') r.writeHead(302, { location: 'file:///etc/passwd' }).end()
      else if (q.url?.startsWith('/loop')) r.writeHead(301, { location: `/loop${q.url.length}` }).end()
      else if (q.url === '/hop') r.writeHead(307, { location: '/final' }).end()
      else r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('final')
    })
    expect(await code(safeFetch(`${s.base}/to-private`, html))).toBe('blocked_address')
    expect(await code(safeFetch(`${s.base}/to-file`, html))).toBe('bad_url')
    expect(await code(safeFetch(`${s.base}/loop`, { ...html, maxRedirects: 3 }))).toBe('redirects')
    const ok = await safeFetch(`${s.base}/hop`, html)
    expect(ok.url).toBe(`${s.base}/final`)
    expect(ok.contentType).toBe('text/html')
  })
})

describe('safeFetch limits', () => {
  it('enforces size cap (declared, streamed, decompressed), content type, status, timeout; sends User-Agent', async () => {
    const big = Buffer.alloc(3 * 1024 * 1024, 97)
    let ua = ''
    const s = await serve((q, r) => {
      ua = String(q.headers['user-agent'])
      if (q.url === '/declared')
        r.writeHead(200, { 'content-type': 'text/html', 'content-length': big.length }).end(big)
      else if (q.url === '/chunked') {
        r.writeHead(200, { 'content-type': 'text/html' })
        r.write(big.subarray(0, 1024 * 1024))
        r.write(big.subarray(0, 1024 * 1024))
        r.end(big.subarray(0, 1024 * 1024))
      } else if (q.url === '/bomb')
        r.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }).end(gzipSync(Buffer.alloc(20e6)))
      else if (q.url === '/gz')
        r.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }).end(gzipSync('packed'))
      else if (q.url === '/pdf') r.writeHead(200, { 'content-type': 'application/pdf' }).end('%PDF')
      else if (q.url === '/missing') r.writeHead(404).end()
      else if (q.url === '/slow') setTimeout(() => r.writeHead(200, { 'content-type': 'text/html' }).end('late'), 500)
    })
    expect(await code(safeFetch(`${s.base}/declared`, html))).toBe('too_large')
    expect(await code(safeFetch(`${s.base}/chunked`, html))).toBe('too_large')
    expect(await code(safeFetch(`${s.base}/bomb`, html))).toBe('too_large')
    expect((await safeFetch(`${s.base}/gz`, html)).body.toString()).toBe('packed')
    expect(await code(safeFetch(`${s.base}/pdf`, html))).toBe('content_type')
    expect(await code(safeFetch(`${s.base}/missing`, html))).toBe('http_status')
    expect(await code(safeFetch(`${s.base}/slow`, { ...html, timeoutMs: 100 }))).toMatch(/Abort|Timeout/)
    expect(ua).toBe(USER_AGENT)
  })
})

describe('robots.txt', () => {
  it('matches * and $ wildcards like the spec', () => {
    const t: [string, string, boolean][] = [
      ['/fish', '/fish.html', true],
      ['/fish', '/Fish', false],
      ['/*.php', '/index.php', true],
      ['/*.php', '/a/b.php?x', true],
      ['/*.php$', '/a.php', true],
      ['/*.php$', '/a.php?x', false],
      ['/fish*.php', '/fishheads/c.php', true],
      ['/a*b*c$', '/abxc', true],
      ['/a*b*c$', '/abc/x', false],
      ['/a*bc$', '/abc', true],
      ['/ab*b$', '/ab', false],
      ['/exact$', '/exact', true],
      ['/exact$', '/exactly', false],
      ['*', '/anything', true],
    ]
    for (const [p, path, want] of t) expect([p, path, matches(p, path)]).toEqual([p, path, want])
  })

  it('handles pathological patterns in linear time (no regex backtracking)', () => {
    const pattern = '/' + '*a'.repeat(200) + '$'
    const path = '/' + 'a'.repeat(5000) + 'b'
    const t0 = performance.now()
    expect(matches(pattern, path)).toBe(false)
    const rules = parseRobots(`User-agent: *\nDisallow: ${'/*a'.repeat(1000)}\nAllow: /${'x'.repeat(600)}`)
    expect(rules.map((r) => [r.allow, r.pattern.length])).toEqual([[false, 512]])
    expect(robotsAllows(rules, path)).toBe(true)
    expect(performance.now() - t0).toBeLessThan(5)
  })

  const txt = `
# comment
User-agent: *
Disallow: /private
Allow: /private/open$

User-agent: OtherBot
Disallow: /

User-agent: JackAppBot
User-agent: Foo
Disallow: /no-jack
Disallow: /*.pdf$
Allow: /no-jack/except
`
  it('parses groups, picks our group over *, longest match wins', () => {
    const mine = parseRobots(txt)
    expect(robotsAllows(mine, '/no-jack/x')).toBe(false)
    expect(robotsAllows(mine, '/no-jack/except/y')).toBe(true)
    expect(robotsAllows(mine, '/doc.pdf')).toBe(false)
    expect(robotsAllows(mine, '/doc.pdf?x')).toBe(true)
    expect(robotsAllows(mine, '/private')).toBe(true) // our group does not mention it
    const star = parseRobots(txt, 'somebot')
    expect(robotsAllows(star, '/private/x')).toBe(false)
    expect(robotsAllows(star, '/private/open')).toBe(true)
    expect(robotsAllows(parseRobots('User-agent: *\nDisallow:\n'), '/x')).toBe(true)
    expect(robotsAllows(parseRobots(''), '/x')).toBe(true)
  })

  it('fetches once per origin; 4xx allows, 5xx/unreachable disallows', async () => {
    let robots: { status: number; body?: string } = { status: 200, body: 'User-agent: *\nDisallow: /secret\n' }
    const s = await serve((q, r) => {
      if (q.url === '/robots.txt') r.writeHead(robots.status, { 'content-type': 'text/plain' }).end(robots.body ?? '')
      else r.end()
    })
    const check = robotsChecker(safeFetch, testNet)
    expect(await check(`${s.base}/secret/a`)).toBe(false)
    expect(await check(`${s.base}/public`)).toBe(true)
    expect(s.hits.filter((h) => h === '/robots.txt')).toHaveLength(1)
    robots = { status: 404 }
    expect(await robotsChecker(safeFetch, testNet)(`${s.base}/secret/a`)).toBe(true)
    robots = { status: 503 }
    expect(await robotsChecker(safeFetch, testNet)(`${s.base}/public`)).toBe(false)
  })
})
