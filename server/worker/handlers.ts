import type { Logger } from 'pino'
import type { AiServices } from '../ai'
import type { CoreEnv } from '../config/env'
import { pathPlanHandler } from '../adaptive/paths'
import { curriculumJobHandlers } from '../curriculum/service'
import type { Db } from '../db/client'
import { defineJobHandler, type JobHandler } from '../jobs/runtime'

/** Services handlers may need beyond the per-job tools (db/log/signal/progress). */
export interface HandlerDeps {
  db: Db
  env: CoreEnv
  ai: AiServices
  log: Logger
}

/** The worker's job handler registry. Each domain contributes its handlers here. */
export function jobHandlers(deps: HandlerDeps): JobHandler[] {
  void deps // used by AI-backed handlers (study processing, generation, images, research)
  return [
    defineJobHandler('curriculum.sync', async (_job, tools) => {
      await curriculumJobHandlers['curriculum.sync'](tools.db, tools.log)
    }),
    pathPlanHandler(deps),
  ]
}
