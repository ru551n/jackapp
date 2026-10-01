# Adult gate

JackApp has no accounts or login; the reverse proxy decides who reaches it. Adults and children share devices, so a **household adult PIN** keeps children out of adult screens and adult-only API routes. It is a **UX guard, not security**: anyone who can reach the app and knows (or resets) the PIN is an adult.

Code: `server/gate/plugin.ts` (cookie, hooks, routes), `server/gate/pin.ts` (hashing, storage), `server/gate/guards.ts` (`requireAdult`, `requireLearner`).

## How it works

- The PIN is 4–8 digits, stored in `household_settings.adult_pin_hash` as `scrypt$<salt>$<hash>` (Node `crypto.scrypt`, random 16-byte salt). Never plain.
- Unlocking sets the cookie `jackapp_gate` holding `{ adultUntil }`, HMAC-signed with `APP_SECRET` (`@fastify/cookie`). httpOnly, `SameSite=Strict`, `path=/`, `secure` when `PUBLIC_URL` is https. A tampered or unsigned cookie is ignored.
- The window is 30 minutes and **sliding**: every API request with a valid cookie renews it.
- Every `/api` request gets `req.gate = { adult }`. Adult routes call `requireAdult(req)`.
- **First run:** while no PIN is set, everyone is adult, so the UI can prompt to create one (`GateState.pinSet === false`).
- **Throttle:** 5 wrong PINs, then all unlock attempts get `429 limit_exceeded` (with `Retry-After`) for 60 s. Kept in memory for the single app process.

## Routes

| Route                      | Who                               | Does                                                    |
| -------------------------- | --------------------------------- | ------------------------------------------------------- |
| `GET /api/v1/gate`         | anyone                            | `GateState` `{ pinSet, adult }`                         |
| `POST /api/v1/gate/pin`    | anyone on first run, adults after | `{ pin }`: create or change the PIN; unlocks the device |
| `POST /api/v1/gate/unlock` | anyone                            | `{ pin }`: unlock (403 `wrong_pin`, 429 when throttled) |
| `POST /api/v1/gate/lock`   | anyone                            | clears the cookie on this device                        |

Locking only clears this device's cookie. Changing the PIN does not revoke other devices' open windows (they expire within 30 min).

## Forgotten PIN

There is no web reset. The host administrator runs, with `DATABASE_URL` set:

```sh
npm run gate:reset-pin
```

This clears the PIN; the app is then in first-run state and the next adult creates a new one.

## Legacy parentPin

The old web app kept a plain 4-digit `parentPin` in localStorage. The legacy import **ignores and discards** it: it is never stored and never becomes the household PIN. Adults set a new PIN in the app.

## CSRF (same-origin check)

The gate relies on a cookie, so every mutating `/api` request (anything but GET/HEAD/OPTIONS) must be same-origin. The `onRequest` hook (`assertSameOrigin` in `server/gate/plugin.ts`) applies to **all** API routes, so route modules need nothing extra:

- `Sec-Fetch-Site` present: must be `same-origin` or `none`.
- otherwise `Origin` present: must equal the origin of `PUBLIC_URL`.
- neither header: allowed (non-browser client such as curl; browsers always send one of them).

Rejected requests get `403 cross_origin`. `SameSite=Strict` is a second layer.

## Tests

`createTestApp()` sets the household PIN to `TEST_PIN` so the gate is closed by default; send the `x-test-adult: 1` header (`asAdult`) to act as an adult. `createTestApp({ pin: null })` gives a first-run household.
