import { createDb } from '../db/client'
import { storePin } from './pin'

// Host-admin reset of a forgotten household PIN: `npm run gate:reset-pin` (needs DATABASE_URL).
// Clears the PIN; the next adult to open the app creates a new one. Never exposed over the web.

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is not set.')
  process.exit(1)
}
const handle = createDb(url, 1)
try {
  await storePin(handle.db, null)
  console.log('Adult PIN cleared. Open JackApp and create a new PIN.')
} finally {
  await handle.close()
}
