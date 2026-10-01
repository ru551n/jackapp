import { z } from 'zod'
import { SchoolPosition } from '../../shared/contracts'
import { AiError } from '../ai'
import { registerJobPayload } from '../jobs/queue'
import { defineJobHandler, type JobHandler, type JobTools } from '../jobs/runtime'
import type { HandlerDeps } from '../worker/handlers'
import { findLicensedImages } from './assets'
import { researchBrief, ResearchError } from './brief'

export const ResearchRunPayload = z.object({
  topic: z.string().trim().min(2).max(200),
  language: z.string().min(2).max(10).default('sv'),
  school: SchoolPosition.optional(),
})
export const AssetFetchPayload = z.object({
  query: z.string().trim().min(2).max(200),
  count: z.number().int().min(1).max(5).default(1),
  preferFactual: z.boolean().default(true),
})

registerJobPayload('research.run', ResearchRunPayload)
registerJobPayload('asset.fetch', AssetFetchPayload)

// Handlers parse again (defence in depth: rows may predate a schema change).
function parsePayload<T>(schema: z.ZodType<T>, payload: unknown, tools: JobTools): T {
  const r = schema.safeParse(payload)
  return r.success ? r.data : tools.fail('bad_payload', 'Ogiltiga jobbparametrar.', false)
}

const rethrow = (e: unknown, tools: JobTools): never => {
  if (e instanceof AiError) tools.fail(e.code, e.message, e.retryable)
  if (e instanceof ResearchError) tools.fail('no_sources', 'Webbsökningen hittade inga användbara källor.', true)
  throw e
}

export function researchJobHandlers(deps: HandlerDeps, env: NodeJS.ProcessEnv = process.env): JobHandler[] {
  return [
    defineJobHandler('research.run', async (job, tools) => {
      const input = parsePayload(ResearchRunPayload, job.payload, tools)
      await tools.progress(0.1, 'Söker på webben')
      const r = await researchBrief(tools.db, deps.ai, input, { env, signal: tools.signal }).catch((e) =>
        rethrow(e, tools),
      )
      if (!r) return tools.fail('feature_disabled', 'Webbsökning är avstängd eller inte konfigurerad.', false)
      return r.briefId
    }),
    defineJobHandler('asset.fetch', async (job, tools) => {
      const input = parsePayload(AssetFetchPayload, job.payload, tools)
      await tools.progress(0.1, 'Söker licensierade bilder')
      const refs = await findLicensedImages(tools.db, input, { env, dataDir: deps.env.DATA_DIR, signal: tools.signal })
      if (!refs.length)
        return tools.fail('no_assets', 'Inga bilder med tillåten licens hittades (eller funktionen är avstängd).', true)
      return refs[0]!.assetId
    }),
  ]
}
