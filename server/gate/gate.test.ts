import { afterEach, describe, expect, it, vi } from 'vitest'
import { householdSettings } from '../db/schema'
import { createTestApp, TEST_PIN } from '../test/helpers'
import { GATE_COOKIE } from './plugin'

let close: (() => Promise<void>) | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  await close?.()
  close = undefined
})

type App = Awaited<ReturnType<typeof createTestApp>>['app']

const gateCookie = (res: { cookies: { name: string; value: string }[] }) =>
  res.cookies.find((c) => c.name === GATE_COOKIE)?.value

const unlock = (app: App, pin: string) => app.inject({ method: 'POST', url: '/api/v1/gate/unlock', payload: { pin } })
const gate = async (app: App, cookie?: string) =>
  (await app.inject({ url: '/api/v1/gate', cookies: cookie ? { [GATE_COOKIE]: cookie } : {} })).json()

describe('adult gate', () => {
  it('is open on first run and lets anyone create the PIN; then changing requires the gate', async () => {
    const t = await createTestApp({ pin: null })
    close = t.close
    expect(await gate(t.app)).toEqual({ pinSet: false, adult: true })

    const bad = await t.app.inject({ method: 'POST', url: '/api/v1/gate/pin', payload: { pin: '12a4' } })
    expect(bad.statusCode).toBe(400)
    const set = await t.app.inject({ method: 'POST', url: '/api/v1/gate/pin', payload: { pin: '135790' } })
    expect(set.json()).toEqual({ pinSet: true, adult: true })
    expect(await gate(t.app, gateCookie(set))).toEqual({ pinSet: true, adult: true })
    expect(await gate(t.app)).toEqual({ pinSet: true, adult: false })

    const change = await t.app.inject({ method: 'POST', url: '/api/v1/gate/pin', payload: { pin: '1111' } })
    expect(change.statusCode).toBe(403)
    const changed = await t.app.inject({
      method: 'POST',
      url: '/api/v1/gate/pin',
      payload: { pin: '1111' },
      cookies: { [GATE_COOKIE]: gateCookie(set)! },
    })
    expect(changed.statusCode).toBe(200)
    expect((await unlock(t.app, '1111')).statusCode).toBe(200)
  })

  it('stores only a scrypt hash', async () => {
    const t = await createTestApp()
    close = t.close
    const [row] = await t.db.select().from(householdSettings)
    expect(row!.adultPinHash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/)
    expect(row!.adultPinHash).not.toContain(TEST_PIN)
  })

  it('unlocks with the PIN, sets a strict httpOnly cookie, slides, and locks', async () => {
    const t = await createTestApp()
    close = t.close
    expect((await unlock(t.app, '0000')).statusCode).toBe(403)
    const ok = await unlock(t.app, TEST_PIN)
    expect(ok.json()).toEqual({ pinSet: true, adult: true })
    const c = ok.cookies.find((x) => x.name === GATE_COOKIE)!
    expect(c).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/', maxAge: 1800 })
    expect(c.secure).toBeFalsy() // PUBLIC_URL is http in tests

    // Sliding: an adult request 20 min later renews the window past the original 30 min.
    const t0 = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 20 * 60_000)
    const renewed = await t.app.inject({ url: '/api/v1/gate', cookies: { [GATE_COOKIE]: c.value } })
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 40 * 60_000)
    expect(await gate(t.app, c.value)).toMatchObject({ adult: false })
    expect(await gate(t.app, gateCookie(renewed))).toMatchObject({ adult: true })

    const locked = await t.app.inject({ method: 'POST', url: '/api/v1/gate/lock', cookies: { [GATE_COOKIE]: c.value } })
    expect(locked.json()).toEqual({ pinSet: true, adult: false })
    expect(gateCookie(locked)).toBe('')
  })

  it('rejects a tampered cookie', async () => {
    const t = await createTestApp()
    close = t.close
    const value = gateCookie(await unlock(t.app, TEST_PIN))!
    const [, sig] = [value.slice(0, value.lastIndexOf('.')), value.slice(value.lastIndexOf('.'))]
    const forged = JSON.stringify({ adultUntil: Date.now() + 10 * 365 * 86400_000 }) + sig
    expect(await gate(t.app, forged)).toMatchObject({ adult: false })
    expect(await gate(t.app, JSON.stringify({ adultUntil: Date.now() + 60_000 }))).toMatchObject({ adult: false })
    expect(await gate(t.app, value)).toMatchObject({ adult: true })
  })

  it('throttles wrong guesses: 5 misses, then an exponential wait', async () => {
    const t = await createTestApp()
    close = t.close
    const now = Date.now()
    const at = (ms: number) => vi.spyOn(Date, 'now').mockReturnValue(now + ms)
    for (let i = 0; i < 5; i++) expect((await unlock(t.app, '9999')).statusCode).toBe(403)
    const blocked = await unlock(t.app, TEST_PIN)
    expect(blocked.statusCode).toBe(429)
    expect(blocked.headers['retry-after']).toBe('60')
    at(61_000)
    for (let i = 0; i < 5; i++) expect((await unlock(t.app, '9999')).statusCode).toBe(403)
    expect((await unlock(t.app, TEST_PIN)).headers['retry-after']).toBe('120') // doubled
    at(61_000 + 121_000)
    expect((await unlock(t.app, TEST_PIN)).statusCode).toBe(200)
  })

  it('admits one PIN check at a time: 100 parallel wrong guesses verify at most 5', async () => {
    const t = await createTestApp()
    close = t.close
    const res = await Promise.all(Array.from({ length: 100 }, () => unlock(t.app, '9999')))
    const codes = res.map((r) => r.statusCode)
    expect(codes.filter((c) => c === 403).length).toBeGreaterThan(0)
    expect(codes.filter((c) => c === 403).length).toBeLessThanOrEqual(5) // each 403 = one scrypt verify
    expect(codes.every((c) => c === 403 || c === 429)).toBe(true)
  })

  it('revokes open cookies when the PIN changes, and caps a cookie at 8 h however it slides', async () => {
    const t = await createTestApp()
    close = t.close
    const a = gateCookie(await unlock(t.app, TEST_PIN))!
    const b = gateCookie(await unlock(t.app, TEST_PIN))!
    const changed = await t.app.inject({
      method: 'POST',
      url: '/api/v1/gate/pin',
      payload: { pin: '13579' },
      cookies: { [GATE_COOKIE]: a },
    })
    expect(changed.statusCode).toBe(200)
    expect(await gate(t.app, b)).toMatchObject({ adult: false }) // other device: revoked
    let c = gateCookie(changed)!
    expect(await gate(t.app, c)).toMatchObject({ adult: true })

    const t0 = Date.now()
    for (let m = 20; m < 8 * 60; m += 20) {
      vi.spyOn(Date, 'now').mockReturnValue(t0 + m * 60_000)
      const r = await t.app.inject({ url: '/api/v1/gate', cookies: { [GATE_COOKIE]: c } })
      expect(r.json()).toMatchObject({ adult: true })
      c = gateCookie(r)!
    }
    vi.spyOn(Date, 'now').mockReturnValue(t0 + 8 * 3_600_000 + 1000)
    expect(await gate(t.app, c)).toMatchObject({ adult: false })
  })

  it('rejects cross-origin mutating requests (CSRF) but allows same-origin and GETs', async () => {
    const t = await createTestApp()
    close = t.close
    const post = (headers: Record<string, string>) =>
      t.app.inject({ method: 'POST', url: '/api/v1/gate/lock', headers })
    expect((await post({ origin: 'https://evil.example' })).statusCode).toBe(403)
    expect((await post({ 'sec-fetch-site': 'cross-site' })).statusCode).toBe(403)
    expect((await post({ 'sec-fetch-site': 'same-site', origin: 'http://localhost:3000' })).statusCode).toBe(403)
    expect((await post({ origin: 'http://localhost:3000' })).statusCode).toBe(200)
    expect((await post({ 'sec-fetch-site': 'same-origin' })).statusCode).toBe(200)
    expect((await post({})).statusCode).toBe(200) // non-browser client
    const get = await t.app.inject({ url: '/api/v1/gate', headers: { 'sec-fetch-site': 'cross-site' } })
    expect(get.statusCode).toBe(200)
  })
})
