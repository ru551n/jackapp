import { describe, expect, it } from 'vitest'
import { loadConfig, startupDiagnostics } from './diagnostics'
import { ConfigError, trustProxyFrom } from './env'

const SECRET = 'S3CRET-app-secret-value-0123456789abcdef'
const base = {
  PUBLIC_URL: 'https://jackapp.example.se',
  DATABASE_URL: 'postgres://jack:DBPASSWORD@db:5432/jackapp',
  APP_SECRET: SECRET,
}

describe('config', () => {
  it('fails clearly on missing/invalid required config, naming variables but never values', () => {
    const err = (() => {
      try {
        loadConfig({ APP_SECRET: 'too-short-secret' })
      } catch (e) {
        return e as ConfigError
      }
    })()
    expect(err).toBeInstanceOf(ConfigError)
    expect(err!.message).toMatch(/PUBLIC_URL/)
    expect(err!.message).toMatch(/DATABASE_URL/)
    expect(err!.message).toMatch(/APP_SECRET/)
    expect(err!.message).not.toContain('too-short-secret')
  })

  it('applies defaults, treats empty values as unset, validates limits', () => {
    const c = loadConfig({ ...base, PORT: '', LIMIT_UPLOAD_PAGES: '', FEATURE_WEB_RESEARCH: '' })
    expect(c.core.PORT).toBe(3000)
    expect(c.limits.LIMIT_UPLOAD_PAGES).toBe(80)
    expect(c.features.FEATURE_WEB_RESEARCH).toBe(true)
    expect(() => loadConfig({ ...base, LIMIT_AI_CONCURRENCY: '0' })).toThrow(/LIMIT_AI_CONCURRENCY/)
    expect(() => loadConfig({ ...base, FEATURE_IMAGE_GENERATION: 'maybe' })).toThrow(/FEATURE_IMAGE_GENERATION/)
  })

  it('enforces ALLOW_CLOUD_AI / ALLOW_LOCAL_AI', () => {
    expect(() => loadConfig({ ...base, ALLOW_CLOUD_AI: 'false', AI_TEXT_PROVIDER: 'openai' })).toThrow(
      /AI_TEXT_PROVIDER/,
    )
    expect(() => loadConfig({ ...base, ALLOW_LOCAL_AI: 'false', AI_VISION_PROVIDER: 'openai-compatible' })).toThrow(
      /AI_VISION_PROVIDER/,
    )
    expect(() => loadConfig({ ...base, ALLOW_CLOUD_AI: 'false', AI_TEXT_PROVIDER: 'openai-compatible' })).not.toThrow()
  })

  it('features are active only when enabled and configured', () => {
    const env = { ...base, AI_IMAGE_PROVIDER: 'openai', FEATURE_WEB_RESEARCH: 'true' }
    const d = startupDiagnostics(loadConfig(env), { reachable: true }, env)
    expect(d.features).toMatchObject({ imageGeneration: true, webResearch: false })
  })

  it('startup diagnostics never contain secrets', () => {
    const env = {
      ...base,
      AI_TEXT_PROVIDER: 'openai-compatible',
      AI_TEXT_BASE_URL: 'http://user:URLPASS@192.168.1.50:8080/v1',
      AI_TEXT_API_KEY: 'sk-TEXTKEY',
      AI_TEXT_MODEL: 'qwen3-32b',
      AI_RESEARCH_PROVIDER: 'brave',
      AI_RESEARCH_API_KEY: 'BRAVEKEY',
    }
    const out = JSON.stringify(startupDiagnostics(loadConfig(env), { reachable: false }, env))
    for (const s of [SECRET, 'DBPASSWORD', 'db:5432', 'URLPASS', '192.168.1.50', 'sk-TEXTKEY', 'BRAVEKEY'])
      expect(out).not.toContain(s)
    expect(out).toContain('qwen3-32b')
    expect(out).toContain('"apiKeySet":true')
  })

  it('TRUST_PROXY never becomes true', () => {
    expect(trustProxyFrom('')).toBe(false)
    expect(trustProxyFrom(' 172.18.0.0/16, 10.0.0.1 ')).toEqual(['172.18.0.0/16', '10.0.0.1'])
  })
})
