import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseAiConfig } from '../ai/config'
import { loadConfig } from './diagnostics'
import { isPlaceholder } from './env'

// .env.example must work as shipped and with any one commented example block uncommented.
const lines = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8').split('\n')
const KEY_LINE = /^# ([A-Z][A-Z0-9_]*=.*)$/

/** Last assignment wins, like Docker Compose env_file and node --env-file. */
function parse(src: string[]): Record<string, string> {
  const env: Record<string, string> = {}
  for (const l of src) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(l)
    if (m) env[m[1]] = m[2]
  }
  return env
}

/** Runs of consecutive `# KEY=value` lines. */
function blocks(): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < lines.length; i++) {
    if (!KEY_LINE.test(lines[i])) continue
    let j = i
    while (j + 1 < lines.length && KEY_LINE.test(lines[j + 1])) j++
    out.push([i, j])
    i = j
  }
  return out
}

const realSecrets = {
  APP_SECRET: 'a3f9c1d2e4b5a6978877665544332211aabbccddeeff',
  DATABASE_URL: 'postgres://jackapp:9f8e7d6c5b4a@db:5432/jackapp',
}

describe('.env.example', () => {
  it('parses as shipped (AI config), and rejects its placeholder secrets', () => {
    const env = parse(lines)
    expect(parseAiConfig(env).text?.provider).toBe('openai')
    expect(isPlaceholder(env.APP_SECRET)).toBe(true)
    expect(isPlaceholder(env.POSTGRES_PASSWORD)).toBe(true)
    expect(() => loadConfig(env)).toThrow(/APP_SECRET/)
  })

  const all = blocks()
  it('has example blocks for every capability', () => {
    const text = all.map(([a, b]) => lines.slice(a, b + 1).join('\n')).join('\n')
    for (const cap of ['TEXT', 'VISION', 'IMAGE', 'EMBEDDING', 'RESEARCH'])
      expect(text).toContain(`AI_${cap}_PROVIDER=`)
  })

  it.each(all.map(([a, b]) => [lines[a], a, b] as const))('uncommenting block "%s" still parses', (_l, a, b) => {
    const src = lines.map((l, i) => (i >= a && i <= b ? l.replace(/^# /, '') : l))
    const env = { ...parse(src), ...realSecrets }
    expect(() => parseAiConfig(env)).not.toThrow()
    expect(() => loadConfig(env)).not.toThrow()
  })
})

describe('placeholder secrets', () => {
  it('rejects obvious placeholders for APP_SECRET and the DB password', () => {
    for (const s of ['change-me-to-64-hex-chars-from-openssl-rand-hex-32', 'CHANGEME-0123456789abcdef0123456789ab'])
      expect(() => loadConfig({ ...realSecrets, PUBLIC_URL: 'https://x.se', APP_SECRET: s })).toThrow(/APP_SECRET/)
    expect(() =>
      loadConfig({
        ...realSecrets,
        PUBLIC_URL: 'https://x.se',
        DATABASE_URL: 'postgres://jackapp:change-me@db/jackapp',
      }),
    ).toThrow(/DATABASE_URL/)
    expect(isPlaceholder('a3f9c1d2e4b5a6978877665544332211')).toBe(false)
  })
})
