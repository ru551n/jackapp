import { describe, expect, it } from 'vitest'
import { ConfigError } from '../config/env'
import { describeAiConfig, parseAiConfig, parseAiLimits } from './config'

const problems = (env: Record<string, string>) => {
  try {
    parseAiConfig(env)
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError)
    return (e as ConfigError).message
  }
  throw new Error('expected ConfigError')
}

describe('AI config', () => {
  it('treats unset providers as disabled and applies defaults', () => {
    expect(parseAiConfig({})).toEqual({})
    const c = parseAiConfig({
      AI_TEXT_PROVIDER: 'openai',
      AI_TEXT_API_KEY: 'k',
      AI_TEXT_MODEL: 'm',
      AI_IMAGE_PROVIDER: 'mock',
    })
    expect(c.text).toMatchObject({ baseUrl: 'https://api.openai.com/v1', timeoutMs: 120000, structured: 'auto' })
    expect(c.image).toMatchObject({ model: 'mock', timeoutMs: 300000 })
    expect(c.vision).toBeUndefined()
  })

  it('validates required fields per provider kind', () => {
    expect(problems({ AI_TEXT_PROVIDER: 'openai-compatible' })).toMatch(/AI_TEXT_BASE_URL.*\n.*AI_TEXT_MODEL/)
    expect(problems({ AI_TEXT_PROVIDER: 'anthropic', AI_TEXT_MODEL: 'm' })).toContain('AI_TEXT_API_KEY')
    expect(problems({ AI_IMAGE_PROVIDER: 'anthropic', AI_IMAGE_MODEL: 'm', AI_IMAGE_API_KEY: 'k' })).toContain(
      'AI_IMAGE_PROVIDER',
    )
    expect(problems({ AI_RESEARCH_PROVIDER: 'searxng' })).toContain('AI_RESEARCH_BASE_URL')
    expect(problems({ AI_RESEARCH_PROVIDER: 'brave' })).toContain('AI_RESEARCH_API_KEY')
    expect(problems({ AI_TEXT_PROVIDER: 'mock', AI_TEXT_STRUCTURED: 'xml', AI_TEXT_TIMEOUT_MS: '-1' })).toMatch(
      /TIMEOUT_MS[\s\S]*STRUCTURED/,
    )
    // Local endpoints need no key; research needs no model.
    expect(() =>
      parseAiConfig({
        AI_TEXT_PROVIDER: 'openai-compatible',
        AI_TEXT_BASE_URL: 'http://h:8080/v1',
        AI_TEXT_MODEL: 'q',
      }),
    ).not.toThrow()
    expect(() =>
      parseAiConfig({ AI_RESEARCH_PROVIDER: 'searxng', AI_RESEARCH_BASE_URL: 'http://s:8888' }),
    ).not.toThrow()
  })

  it('enforces ALLOW_CLOUD_AI and ALLOW_LOCAL_AI', () => {
    const cloud = { AI_TEXT_PROVIDER: 'openai', AI_TEXT_API_KEY: 'k', AI_TEXT_MODEL: 'm' }
    expect(problems({ ...cloud, ALLOW_CLOUD_AI: 'false' })).toContain('ALLOW_CLOUD_AI')
    const local = { AI_TEXT_PROVIDER: 'anthropic-compatible', AI_TEXT_BASE_URL: 'http://h', AI_TEXT_MODEL: 'm' }
    expect(problems({ ...local, ALLOW_LOCAL_AI: '0' })).toContain('ALLOW_LOCAL_AI')
    expect(() => parseAiConfig({ ...local, ALLOW_CLOUD_AI: 'false' })).not.toThrow()
  })

  it('never puts secret values in errors or diagnostics', () => {
    const secret = 'sk-SUPERSECRET'
    const msg = problems({
      AI_TEXT_PROVIDER: 'openai-compatible',
      AI_TEXT_API_KEY: secret,
      AI_TEXT_BASE_URL: `notaurl-${secret}`,
    })
    expect(msg).not.toContain(secret)

    const cfg = parseAiConfig({
      AI_TEXT_PROVIDER: 'openai-compatible',
      AI_TEXT_API_KEY: secret,
      AI_TEXT_BASE_URL: 'http://user:pw-SECRET@llm.lan:8080/v1?token=SECRET2',
      AI_TEXT_MODEL: 'qwen',
    })
    const d = describeAiConfig(cfg)
    expect(d.text).toEqual({ provider: 'openai-compatible', model: 'qwen', keySet: true, host: 'llm.lan:8080' })
    expect(d.image).toBe('disabled')
    expect(JSON.stringify(d)).not.toMatch(/SECRET|pw|token/)
  })

  it('parses limits', () => {
    expect(parseAiLimits({})).toEqual({ requestsPerHour: 2000, concurrency: 4 })
    expect(() => parseAiLimits({ LIMIT_AI_CONCURRENCY: '0' })).toThrow(/LIMIT_AI_CONCURRENCY/)
  })
})
