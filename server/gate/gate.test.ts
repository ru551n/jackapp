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

  it('throttles wrong guesses: 5 misses, then a 60 s wait', async () => {
    const t = await createTestApp()
    close = t.close
    for (let i = 0; i < 5; i++) expect((await unlock(t.app, '9999')).statusCode).toBe(403)
    const blocked = await unlock(t.app, TEST_PIN)
    expect(blocked.statusCode).toBe(429)
    expect(blocked.headers['retry-after']).toBe('60')
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 61_000)
    expect((await unlock(t.app, TEST_PIN)).statusCode).toBe(200)
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
