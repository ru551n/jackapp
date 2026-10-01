import { createInterface } from 'node:readline/promises'
import { createDb } from '../db/client'
import { Pin, storePin } from './pin'

// Host-admin reset of a forgotten household PIN (needs DATABASE_URL). Sets a NEW PIN directly, so
// the app is never left open in first-run state:
//   docker compose exec app node dist-server/gate-reset-pin.js [NEW_PIN]   (dev: npm run gate:reset-pin)
// Without an argument it prompts. Never exposed over the web.

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}
let pin = process.argv[2]
if (!pin) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  pin = (await rl.question('New adult PIN (4–8 digits): ')).trim()
  rl.close()
}
if (!Pin.safeParse(pin).success) {
  console.error('The PIN must be 4–8 digits. Nothing was changed.')
  process.exit(1)
}
const handle = createDb(url, 1)
try {
  await storePin(handle.db, pin)
  console.log('Adult PIN changed. Unlock JackApp with the new PIN.')
} finally {
  await handle.close()
}
