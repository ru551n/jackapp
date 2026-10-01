import cookie from '@fastify/cookie'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { API_PREFIX, type GateState } from '../../shared/contracts'
import type { AppContext } from '../app/context'
import { HttpError, requireAdult } from './guards'
import { getPinHash, Pin, storePin, verifyPin } from './pin'

// Adult gate: signed cookie { adultUntil }, household PIN, unlock throttle, same-origin check.
// See docs/platform/gate.md.

export const GATE_COOKIE = 'jackapp_gate'
export const ADULT_WINDOW_MS = 30 * 60_000
const MAX_FAILS = 5
const LOCKOUT_MS = 60_000
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
  const throttle = { fails: 0, lockedUntil: 0 }

  await app.register(cookie, { secret: ctx.env.APP_SECRET })

  const setAdultCookie = (reply: FastifyReply) =>
    reply.setCookie(GATE_COOKIE, JSON.stringify({ adultUntil: Date.now() + ADULT_WINDOW_MS }), {
      signed: true,
      httpOnly: true,
      sameSite: 'strict',
      secure,
      path: '/',
      maxAge: ADULT_WINDOW_MS / 1000,
    })

  const cookieAdult = (req: FastifyRequest): boolean => {
    const raw = req.cookies[GATE_COOKIE]
    if (!raw) return false
    const r = req.unsignCookie(raw)
    if (!r.valid || !r.value) return false
    try {
      const until = (JSON.parse(r.value) as { adultUntil?: unknown }).adultUntil
      return typeof until === 'number' && until > Date.now()
    } catch {
      return false
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
    if (cookieAdult(req)) {
      req.gate.adult = true
      setAdultCookie(reply) // sliding window
    } else if ((await getPinHash(ctx.db)) === null) {
      req.gate.adult = true // first run: open until a PIN is created
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
        setAdultCookie(reply)
        req.gate = { adult: true }
        return state(req)
      })

      api.post('/gate/unlock', async (req, reply) => {
        const { pin } = z.object({ pin: z.string().max(16) }).parse(req.body)
        const now = Date.now()
        if (now < throttle.lockedUntil) {
          reply.header('retry-after', Math.ceil((throttle.lockedUntil - now) / 1000))
          throw new HttpError(429, 'limit_exceeded', 'För många försök. Vänta en minut.')
        }
        const hash = await getPinHash(ctx.db)
        if (hash === null) return state(req)
        if (!(await verifyPin(pin, hash))) {
          if (++throttle.fails >= MAX_FAILS) Object.assign(throttle, { fails: 0, lockedUntil: now + LOCKOUT_MS })
          throw new HttpError(403, 'wrong_pin', 'Fel PIN-kod.')
        }
        throttle.fails = 0
        setAdultCookie(reply)
        req.gate = { adult: true }
        return state(req)
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
