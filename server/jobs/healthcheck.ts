import { hostname } from 'node:os'
import { createDb } from '../db/client'
import { checkWorkerHealth } from './health'

// Compose worker healthcheck: exit 0 if this container's worker beat within 60 s, else 1.
const url = process.env.DATABASE_URL
if (!url) process.exit(1)
const handle = createDb(url, 1)
try {
  const h = await checkWorkerHealth(handle.db, { maxAgeSeconds: 60, workerIdPrefix: `${hostname()}-` })
  process.exitCode = h.ok ? 0 : 1
} catch {
  process.exitCode = 1
} finally {
  await handle.close()
}
