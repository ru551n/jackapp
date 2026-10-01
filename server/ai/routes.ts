import type { SystemStatus } from '../../shared/contracts'
import { runReadiness } from '../app/build'
import type { RouteModule } from '../app/context'
import { parseEnv } from '../config/env'
import { activeFeatures, FeaturesEnv } from '../config/features'
import { LimitsEnv } from '../config/limits'

// GET /api/v1/system/status: human-friendly availability for adults. No URLs, keys or model ids.

export const systemStatusRoutes: RouteModule = (app, ctx) => {
  app.get('/system/status', async (): Promise<SystemStatus> => {
    const { ready } = await runReadiness(ctx.readiness) // also refreshes cached AI reachability
    const capabilities = ctx.ai?.status() ?? []
    const configured = (cap: string) => capabilities.some((c) => c.capability === cap.toLowerCase() && c.configured)
    const limits = parseEnv(LimitsEnv)
    return {
      ready,
      capabilities,
      features: activeFeatures(parseEnv(FeaturesEnv), process.env, configured),
      limits: {
        maxUploadFileMb: limits.LIMIT_UPLOAD_FILE_MB,
        maxUploadTotalMb: limits.LIMIT_UPLOAD_TOTAL_MB,
        maxPagesPerSet: limits.LIMIT_UPLOAD_PAGES,
      },
    }
  })
}
