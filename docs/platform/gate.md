# Adult gate

JackApp has no accounts or login; the reverse proxy decides who reaches it. Adults and children share devices, so a **household adult PIN** keeps children out of adult screens and adult-only API routes. It is a **UX guard, not security**: anyone who can reach the app and knows (or resets) the PIN is an adult.

Code: `server/gate/plugin.ts` (cookie, hooks, routes), `server/gate/pin.ts` (hashing, storage), `server/gate/guards.ts` (`requireAdult`, `requireLearner`).

## How it works

- The PIN is 4–8 digits, stored in `household_settings.adult_pin_hash` as `scrypt$<salt>$<hash>` (Node `crypto.scrypt`, random 16-byte salt). Never plain.
- Unlocking sets the cookie `jackapp_gate` holding `{ adultUntil, issuedAt, epoch }`, HMAC-signed with `APP_SECRET` (`@fastify/cookie`). httpOnly, `SameSite=Strict`, `path=/`, `secure` when `PUBLIC_URL` is https. A tampered or unsigned cookie is ignored.
- The window is 30 minutes and **sliding**: every API request with a valid cookie renews it, but never past **8 hours** after the unlock (`issuedAt`); then the adult enters the PIN again.
- `epoch` is derived from the stored PIN hash (HMAC with `APP_SECRET`). **Changing the PIN revokes every open cookie** on every device.
- Every `/api` request gets `req.gate = { adult }`. Adult routes call `requireAdult(req)`.
- **First run:** while no PIN is set, everyone is adult, so the UI can prompt to create one (`GateState.pinSet === false`).
- **Throttle:** only one PIN check runs at a time (a parallel attempt gets `429` at once), so concurrent guesses cannot outrun the counter. 5 wrong PINs lock unlocking (`429 limit_exceeded` with `Retry-After`) for 60 s; each further lockout doubles (2, 4, 8 min …, max 1 h) until a correct PIN resets it. Kept in memory for the single app process.

## Routes

| Route                      | Who                               | Does                                                    |
| -------------------------- | --------------------------------- | ------------------------------------------------------- |
| `GET /api/v1/gate`         | anyone                            | `GateState` `{ pinSet, adult }`                         |
| `POST /api/v1/gate/pin`    | anyone on first run, adults after | `{ pin }`: create or change the PIN; unlocks the device |
| `POST /api/v1/gate/unlock` | anyone                            | `{ pin }`: unlock (403 `wrong_pin`, 429 when throttled) |
| `POST /api/v1/gate/lock`   | anyone                            | clears the cookie on this device                        |

Locking only clears this device's cookie. Changing the PIN revokes all devices' open windows.

The start page (`/`, the learner picker) calls `POST /gate/lock` when it opens: a device back at the picker may be handed to a child.

## Forgotten PIN

There is no web reset. The host administrator runs, in the Docker Compose deployment (the `app` container already has `DATABASE_URL`):

```sh
docker compose exec -it app node dist-server/gate-reset-pin.js          # prompts for the new PIN
docker compose exec app node dist-server/gate-reset-pin.js 135790       # or pass it (lands in shell history)
```

From a source checkout (dev dependencies installed), with `DATABASE_URL` set: `npm run gate:reset-pin [-- NEW_PIN]`.

The reset **sets the new PIN directly** (and so revokes all open cookies). It never clears the PIN: a cleared PIN would put the app back in first-run state, where everyone is adult and whoever opens it first (possibly a child) could claim the PIN.

The first-run window itself (fresh install, before the first PIN) is still open to anyone who reaches the app; set the PIN right after installing. A setup token for that first `POST /gate/pin` is not implemented (it needs a field in the first-run UI).

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
