// Compose healthcheck for the worker: exit 0 when this container wrote a DB heartbeat recently
// (the runtime touches the file only after a successful heartbeat write; server/worker/start.ts).
import { statSync } from 'node:fs'
import { HEARTBEAT_MS, heartbeatPath } from './start'

const file = heartbeatPath(process.env.DATA_DIR || '/data')
let age = Infinity
try {
  age = Date.now() - statSync(file).mtimeMs
} catch {}
if (age > HEARTBEAT_MS * 4) {
  console.error(`worker heartbeat stale or missing: ${file}`)
  process.exit(1)
}
