// Worker shell: the job runtime (server/jobs) plugs in through startWorker's `run`.
import { mkdirSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import type { Logger } from 'pino'
import type { CoreEnv } from '../config/env'
import type { Config } from '../config/diagnostics'
import type { Db } from '../db/client'

/** Per-container heartbeat file; `worker-health.js` (the compose healthcheck) checks its age. */
export const heartbeatPath = (dataDir: string) => join(dataDir, `worker-heartbeat-${hostname()}`)
export const HEARTBEAT_MS = 15_000

export interface WorkerDeps<H> {
  db: Db
  env: CoreEnv
  config: Config
  log: Logger
  /** Job handler registry (server/worker), consumed by the runtime. */
  handlers: H
  /** Aborted on SIGTERM/SIGINT: finish or release the current job, then return. */
  signal: AbortSignal
  /** Touch the healthcheck file; the runtime calls it after each successful DB heartbeat. */
  beat: () => void
}

/** The job runtime (server/jobs) plugs in here. Default: idle until shutdown. */
export type WorkerRun<H> = (deps: WorkerDeps<H>) => Promise<void>

const idle: WorkerRun<unknown> = ({ signal }) =>
  new Promise((done) => (signal.aborted ? done() : signal.addEventListener('abort', () => done(), { once: true })))

export function startWorker<H>(opts: Omit<WorkerDeps<H>, 'signal' | 'beat'> & { run?: WorkerRun<H> }) {
  const ctrl = new AbortController()
  const file = heartbeatPath(opts.env.DATA_DIR)
  mkdirSync(opts.env.DATA_DIR, { recursive: true })
  const beat = () => writeFileSync(file, String(Date.now()))
  // A plugged-in runtime beats itself (after DB heartbeats); the idle default only proves liveness.
  const timer = opts.run ? undefined : setInterval(beat, HEARTBEAT_MS)
  if (!opts.run) beat()
  opts.log.info('worker ready')
  const done = (opts.run ?? idle)({ ...opts, signal: ctrl.signal, beat }).finally(() => clearInterval(timer))
  return { done, beat, stop: () => (ctrl.abort(), done) }
}
