import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pino } from 'pino'
import { describe, expect, it } from 'vitest'
import { TEST_ENV } from '../test/helpers'
import { heartbeatPath, startWorker } from './start'

describe('worker shell', () => {
  it('the plugged-in runtime writes the heartbeat, and stops on abort', async () => {
    const env = { ...TEST_ENV, DATA_DIR: mkdtempSync(join(tmpdir(), 'jackapp-data-')) }
    let saw: unknown
    const w = startWorker({
      db: {} as never,
      env,
      config: {} as never,
      log: pino({ enabled: false }),
      handlers: { 'uploads.cleanup': 1 },
      run: async ({ handlers, signal, beat }) => {
        saw = handlers
        beat()
        await new Promise((r) => signal.addEventListener('abort', r))
      },
    })
    expect(statSync(heartbeatPath(env.DATA_DIR)).mtimeMs).toBeGreaterThan(Date.now() - 5000)
    await w.stop()
    expect(saw).toEqual({ 'uploads.cleanup': 1 })
  })
})
