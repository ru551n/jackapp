import cookie from '@fastify/cookie'
import { createHmac } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { API_PREFIX, type GateState } from '../../shared/contracts'
import type { AppContext } from '../app/context'
import { HttpError, requireAdult } from './guards'
import { getPinHash, Pin, storePin, verifyPin } from './pin'

// Adult gate: signed cookie { adultUntil, issuedAt, epoch }, household PIN, unlock throttle,
// same-origin check. See docs/platform/gate.md.

export const GATE_COOKIE = 'jackapp_gate'
export const ADULT_WINDOW_MS = 30 * 60_000
/** Absolute cookie lifetime: sliding renewals never extend an unlock past this. */
export const ADULT_MAX_AGE_MS = 8 * 3_600_000
const MAX_FAILS = 5
const LOCKOUT_MS = 60_000
const MAX_LOCKOUT_MS = 3_600_000
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * CSRF guard for mutating requests. Browsers always send Sec-Fetch-Site and/or Origin on
 * non-GET fetches; requests with neither are non-browser clients (curl, tests) and pass.
 */
export function assertSameOrigin(req: FastifyRequest, publicOrigin: string): void {
  if (SAFE_METHODS.has(req.method)) return
  const site = req.headers['sec-fetch-site']
  if (site !== undefined) {
    if (site === 'same-origin' || site === 'none') return
  } else if (req.headers.origin === undefined || req.headers.origin === publicOrigin) return
  throw new HttpError(403, 'cross_origin', 'Förfrågan kom från en annan webbplats.')
}

export async function registerGate(app: FastifyInstance, ctx: AppContext) {
  const publicOrigin = new URL(ctx.env.PUBLIC_URL).origin
  const secure = publicOrigin.startsWith('https:')
  // ponytail: in-memory, per process (one app container); move to the DB if the app is scaled out.
  // `busy` admits one PIN check at a time, so parallel guesses can't outrun the counter.
  const throttle = { fails: 0, lockouts: 0, lockedUntil: 0, busy: false }

  await app.register(cookie, { secret: ctx.env.APP_SECRET })

  /** Changes whenever the PIN changes, so a PIN change revokes every open cookie. */
  const epochOf = (hash: string) => createHmac('sha256', ctx.env.APP_SECRET).update(hash).digest('base64url').slice(0, 16)

  const setAdultCookie = (reply: FastifyReply, hash: string, issuedAt = Date.now()) =>
    reply.setCookie(
      GATE_COOKIE,
      JSON.stringify({ adultUntil: Date.now() + ADULT_WINDOW_MS, issuedAt, epoch: epochOf(hash) }),
      { signed: true, httpOnly: true, sameSite: 'strict', secure, path: '/', maxAge: ADULT_WINDOW_MS / 1000 },
    )

  /** The cookie's issuedAt when it is a valid adult cookie for the current PIN, else undefined. */
  const cookieIssuedAt = (req: FastifyRequest, hash: string): number | undefined => {
    const raw = req.cookies[GATE_COOKIE]
    if (!raw) return undefined
    const r = req.unsignCookie(raw)
    if (!r.valid || !r.value) return undefined
    try {
      const c = JSON.parse(r.value) as { adultUntil?: unknown; issuedAt?: unknown; epoch?: unknown }
      const now = Date.now()
      const ok =
        typeof c.adultUntil === 'number' &&
        c.adultUntil > now &&
        typeof c.issuedAt === 'number' &&
        now - c.issuedAt < ADULT_MAX_AGE_MS &&
        c.epoch === epochOf(hash)
      return ok ? (c.issuedAt as number) : undefined
    } catch {
      return undefined
    }
  }

  const state = async (req: FastifyRequest): Promise<GateState> => {
    const pinSet = (await getPinHash(ctx.db)) !== null
    return { pinSet, adult: !pinSet || (req.gate?.adult ?? false) }
  }

  app.addHook('onRequest', async (req, reply) => {
    req.gate = { adult: false }
    if (!req.url.startsWith(API_PREFIX)) return
    assertSameOrigin(req, publicOrigin)
    const hash = await getPinHash(ctx.db)
    if (hash === null) {
      req.gate.adult = true // first run: open until a PIN is created
      return
    }
    const issuedAt = cookieIssuedAt(req, hash)
    if (issuedAt !== undefined) {
      req.gate.adult = true
      setAdultCookie(reply, hash, issuedAt) // sliding window, capped by ADULT_MAX_AGE_MS
    }
  })

  await app.register(
    async (api) => {
      api.get('/gate', async (req) => state(req))

      /** Create the PIN (first run) or change it (adult only). */
      api.post('/gate/pin', async (req, reply) => {
        const { pin } = z.object({ pin: Pin }).parse(req.body)
        if ((await getPinHash(ctx.db)) !== null) requireAdult(req)
        await storePin(ctx.db, pin)
        setAdultCookie(reply, (await getPinHash(ctx.db))!)
        req.gate = { adult: true }
        return state(req)
      })

      api.post('/gate/unlock', async (req, reply) => {
        const { pin } = z.object({ pin: z.string().max(16) }).parse(req.body)
        // Reserve the attempt synchronously: no await between this check and `busy = true`.
        const now = Date.now()
        if (throttle.busy || now < throttle.lockedUntil) {
          reply.header('retry-after', Math.max(1, Math.ceil((throttle.lockedUntil - now) / 1000)))
          throw new HttpError(429, 'limit_exceeded', 'För många försök. Vänta en stund.')
        }
        throttle.busy = true
        try {
          const hash = await getPinHash(ctx.db)
          if (hash === null) return await state(req)
          if (!(await verifyPin(pin, hash))) {
            if (++throttle.fails >= MAX_FAILS) {
              const wait = Math.min(LOCKOUT_MS * 2 ** throttle.lockouts++, MAX_LOCKOUT_MS)
              Object.assign(throttle, { fails: 0, lockedUntil: Date.now() + wait })
            }
            throw new HttpError(403, 'wrong_pin', 'Fel PIN-kod.')
          }
          Object.assign(throttle, { fails: 0, lockouts: 0 })
          setAdultCookie(reply, hash)
          req.gate = { adult: true }
          return await state(req)
        } finally {
          throttle.busy = false
        }
      })

      api.post('/gate/lock', async (req, reply) => {
        reply.clearCookie(GATE_COOKIE, { path: '/' })
        req.gate = { adult: false }
        return state(req)
      })
    },
    { prefix: API_PREFIX },
  )
}
