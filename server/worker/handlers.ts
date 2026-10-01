import type { Logger } from 'pino'
import { parseAiConfig, type AiServices } from '../ai'
import type { CoreEnv } from '../config/env'
import { pathPlanHandler } from '../adaptive/paths'
import { curriculumJobHandlers } from '../curriculum/service'
import type { Db } from '../db/client'
import { imageJobHandler } from '../images'
import { generationJobHandlers } from '../generation/jobs'
import { applyJobMedia } from '../generation/media'
import { defineJobHandler, type JobHandler } from '../jobs/runtime'
import { studyHandlers } from '../study/process'
import type { ResearchOptions } from '../research/brief'
import { researchJobHandlers } from '../research/jobs'

/** Services handlers may need beyond the per-job tools (db/log/signal/progress). */
export interface HandlerDeps {
  db: Db
  env: CoreEnv
  ai: AiServices
  log: Logger
  /** Outbound fetching for research and licensed assets (tests inject a fake network). */
  net?: Pick<ResearchOptions, 'fetcher' | 'fetchOptions'>
}

/**
 * Completion hooks, composed here so domains never import each other: a finished image or
 * licensed-asset job lands in its artifact as a new version (server/generation/media.ts).
 */
const ON_COMPLETED: Partial<Record<JobHandler['type'], JobHandler['onCompleted']>> = {
  'image.generate': applyJobMedia,
  'asset.fetch': applyJobMedia,
}

/** The worker's job handler registry. Each domain contributes its handlers here. */
export function jobHandlers(deps: HandlerDeps): JobHandler[] {
  const handlers = [
    defineJobHandler('curriculum.sync', async (_job, tools) => {
      await curriculumJobHandlers['curriculum.sync'](tools.db, tools.log)
    }),
    imageJobHandler({ ai: deps.ai, dataDir: deps.env.DATA_DIR }),
    ...studyHandlers(deps),
    ...researchJobHandlers(deps),
    pathPlanHandler(deps),
    ...generationJobHandlers({
      ai: deps.ai,
      providerKind: parseAiConfig(process.env).text?.provider,
      research: deps.net,
    }),
  ]
  return handlers.map((h) => (ON_COMPLETED[h.type] ? { ...h, onCompleted: ON_COMPLETED[h.type] } : h))
}
