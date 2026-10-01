import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { MIGRATIONS_DIR } from '../db/migrations'

// The runtime image has only dist-server/, server/db/migrations and dist/ (no tsx, no sources).
// Build the real bundle and check that everything read at runtime is in it.

const out = mkdtempSync(join(tmpdir(), 'jackapp-bundle-'))
afterAll(() => rmSync(out, { recursive: true, force: true }))

describe('server bundle', () => {
  it('contains every entrypoint and runtime data file, and runs without dev dependencies', () => {
    // The build script itself fails when a `new URL(..., import.meta.url)` target is missing.
    execFileSync(process.execPath, ['scripts/build-server.mjs'], { env: { ...process.env, BUILD_SERVER_OUT: out } })
    for (const f of ['main.js', 'worker.js', 'migrate.js', 'worker-health.js', 'gate-reset-pin.js', 'sharp-version'])
      expect(existsSync(join(out, f)), f).toBe(true)
    expect(readdirSync(join(out, 'data'))).toEqual(readdirSync('server/curriculum/data'))

    // Bundled CLI starts with plain node and refuses without DATABASE_URL.
    const env = { PATH: process.env.PATH }
    const r = spawnSync(process.execPath, [join(out, 'gate-reset-pin.js')], { env, encoding: 'utf8' })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('DATABASE_URL is not set.')
  })

  it('ships migrations where the bundle reads them (working-directory relative)', () => {
    expect(MIGRATIONS_DIR.endsWith(join('server', 'db', 'migrations'))).toBe(true)
    expect(existsSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'))).toBe(true)
    const docker = readFileSync('Dockerfile', 'utf8')
    expect(docker).toMatch(/^WORKDIR \/app$/m)
    expect(docker).toContain('COPY --from=server /app/dist-server ./dist-server')
    expect(docker).toContain('COPY --from=server /app/server/db/migrations ./server/db/migrations')
  })
})
