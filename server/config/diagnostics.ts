import { sql } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { Db } from '../db/client'
import { ConfigError, CoreEnv, parseEnv } from './env'
import { activeFeatures, checkProviderPolicy, FeaturesEnv } from './features'
import { LimitsEnv } from './limits'

/** Everything the app and worker validate at startup. Throws ConfigError (names only, never values). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const core = parseEnv(CoreEnv, env)
  const features = parseEnv(FeaturesEnv, env)
  const limits = parseEnv(LimitsEnv, env)
  checkProviderPolicy(features, env)
  return { core, features, limits }
}
export type Config = ReturnType<typeof loadConfig>

const CAPS = ['text', 'vision', 'image', 'embedding', 'research'] as const

/**
 * Startup diagnostics: safe to log. Never includes secrets, DATABASE_URL, base URLs (may embed
 * credentials) or API keys; only whether they are set.
 */
export function startupDiagnostics(
  cfg: Config,
  database: { reachable: boolean },
  env: NodeJS.ProcessEnv = process.env,
) {
  const ai = Object.fromEntries(
    CAPS.map((cap) => {
      const p = `AI_${cap.toUpperCase()}_`
      const provider = env[`${p}PROVIDER`] || undefined
      return [
        cap,
        provider
          ? {
              provider,
              model: env[`${p}MODEL`] || null,
              customEndpoint: !!env[`${p}BASE_URL`],
              apiKeySet: !!env[`${p}API_KEY`],
            }
          : { provider: null },
      ]
    }),
  )
  return {
    nodeEnv: cfg.core.NODE_ENV,
    port: cfg.core.PORT,
    publicUrl: cfg.core.PUBLIC_URL,
    dataDir: cfg.core.DATA_DIR,
    trustProxy: cfg.core.TRUST_PROXY || 'none',
    database: { configured: !!cfg.core.DATABASE_URL, reachable: database.reachable },
    ai,
    features: {
      ...activeFeatures(cfg.features, env),
      allowCloudAi: cfg.features.ALLOW_CLOUD_AI,
      allowLocalAi: cfg.features.ALLOW_LOCAL_AI,
    },
    limits: cfg.limits,
  }
}

export function dbReachable(db: Db): Promise<boolean> {
  return db.execute(sql`select 1`).then(
    () => true,
    () => false,
  )
}

/** Log a startup failure without values (ConfigError lists variable names only) and exit. */
export function fail(log: Logger, err: unknown): never {
  if (err instanceof ConfigError) log.fatal({ problems: err.problems }, 'invalid configuration')
  else log.fatal({ err: { name: (err as Error).name, message: (err as Error).message } }, 'startup failed')
  process.exit(1)
}
