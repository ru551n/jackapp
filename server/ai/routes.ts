import type { SystemStatus } from '../../shared/contracts'
import { runReadiness } from '../app/build'
import type { RouteModule } from '../app/context'

// GET /api/v1/system/status: human-friendly availability for adults. No URLs, keys or model ids.

const flag = (v: string | undefined, def: boolean) =>
  v === undefined || v === '' ? def : ['true', '1', 'yes'].includes(v)
const num = (v: string | undefined, def: number) => (v && Number.isFinite(Number(v)) ? Number(v) : def)

export const systemStatusRoutes: RouteModule = (app, ctx) => {
  app.get('/system/status', async (): Promise<SystemStatus> => {
    // ponytail: reads FEATURE_*/LIMIT_* directly; switch to server/config/features.ts + limits.ts once they exist.
    const env = process.env
    const { ready } = await runReadiness(ctx.readiness) // also refreshes cached AI reachability
    const capabilities = ctx.ai?.status() ?? []
    const configured = (cap: string) => capabilities.some((c) => c.capability === cap && c.configured)
    return {
      ready,
      capabilities,
      features: {
        webResearch: flag(env.FEATURE_WEB_RESEARCH, true) && configured('research'),
        externalAssets: flag(env.FEATURE_EXTERNAL_ASSETS, true),
        imageGeneration: flag(env.FEATURE_IMAGE_GENERATION, true) && configured('image'),
      },
      limits: {
        maxUploadFileMb: num(env.LIMIT_UPLOAD_FILE_MB, 30),
        maxUploadTotalMb: num(env.LIMIT_UPLOAD_TOTAL_MB, 300),
        maxPagesPerSet: num(env.LIMIT_UPLOAD_PAGES, 80),
      },
    }
  })
}
