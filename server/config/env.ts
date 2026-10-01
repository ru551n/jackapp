import { z } from 'zod'

// Host-admin configuration from the environment. Validated once at startup; secrets are never
// logged or sent to clients. Each subsystem adds its own group here (see .env.example for docs).

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .optional()
    .transform((v) => (v === undefined ? def : ['true', '1', 'yes'].includes(v)))

export const CoreEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  /** Externally visible origin, e.g. https://jackapp.example.se (behind Caddy). */
  PUBLIC_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  /** ≥32 random chars; signs the adult-gate cookie. */
  APP_SECRET: z.string().min(32),
  /** Root for persistent files (generated assets, processed material, temporary uploads). */
  DATA_DIR: z.string().default('/data'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Comma-separated proxy IPs/CIDRs whose X-Forwarded-* headers are trusted (e.g. the Caddy container network). */
  TRUST_PROXY: z.string().default(''),
  /** Serve the built web app from this directory (production single container). */
  WEB_DIST_DIR: z.string().default('dist'),
})
export type CoreEnv = z.infer<typeof CoreEnv>

export class ConfigError extends Error {
  readonly problems: string[]
  constructor(problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`)
    this.problems = problems
  }
}

/** Parse a zod env group; throws ConfigError listing variable names (never values). */
export function parseEnv<T extends z.ZodTypeAny>(schema: T, env: NodeJS.ProcessEnv = process.env): z.infer<T> {
  // Empty values (`KEY=` in .env) mean "unset", so defaults apply.
  const r = schema.safeParse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '')))
  if (r.success) return r.data
  throw new ConfigError(r.error.issues.map((i) => `${i.path.join('.') || '(env)'}: ${i.message}`))
}

export { bool as envBool }

/** TRUST_PROXY → Fastify `trustProxy`: a list of IPs/CIDRs, or false (trust none). Never `true`. */
export function trustProxyFrom(value: string): string[] | false {
  const list = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.length ? list : false
}
