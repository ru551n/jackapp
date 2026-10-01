import { z } from 'zod'
import { ConfigError, envBool } from './env'

// Feature switches (docs/platform/env.md). A feature is active only when enabled AND its
// capability is configured; ALLOW_* reject whole provider classes at startup.

export const FeaturesEnv = z.object({
  FEATURE_WEB_RESEARCH: envBool(true),
  FEATURE_EXTERNAL_ASSETS: envBool(true),
  FEATURE_IMAGE_GENERATION: envBool(true),
  ALLOW_CLOUD_AI: envBool(true),
  ALLOW_LOCAL_AI: envBool(true),
})
export type FeaturesEnv = z.infer<typeof FeaturesEnv>

const CAPS = ['TEXT', 'VISION', 'IMAGE', 'EMBEDDING', 'RESEARCH'] as const
const CLOUD = new Set(['openai', 'anthropic'])
const LOCAL = new Set(['openai-compatible', 'anthropic-compatible'])

const provider = (env: NodeJS.ProcessEnv, cap: (typeof CAPS)[number]) => env[`AI_${cap}_PROVIDER`]?.trim() || undefined

/** Throws ConfigError when a configured provider is disallowed by ALLOW_CLOUD_AI / ALLOW_LOCAL_AI. */
export function checkProviderPolicy(f: FeaturesEnv, env: NodeJS.ProcessEnv = process.env): void {
  const problems: string[] = []
  for (const cap of CAPS) {
    const p = provider(env, cap)
    if (p && !f.ALLOW_CLOUD_AI && CLOUD.has(p))
      problems.push(`AI_${cap}_PROVIDER: cloud provider "${p}" but ALLOW_CLOUD_AI=false`)
    if (p && !f.ALLOW_LOCAL_AI && LOCAL.has(p))
      problems.push(`AI_${cap}_PROVIDER: local provider "${p}" but ALLOW_LOCAL_AI=false`)
  }
  if (problems.length) throw new ConfigError(problems)
}

/** Effective features (shape of SystemStatus.features). */
export function activeFeatures(f: FeaturesEnv, env: NodeJS.ProcessEnv = process.env) {
  return {
    webResearch: f.FEATURE_WEB_RESEARCH && !!provider(env, 'RESEARCH'),
    // ponytail: external assets have no capability of their own yet; tie to one if the research agent adds it.
    externalAssets: f.FEATURE_EXTERNAL_ASSETS,
    imageGeneration: f.FEATURE_IMAGE_GENERATION && !!provider(env, 'IMAGE'),
  }
}
