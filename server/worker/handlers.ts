import type { Logger } from 'pino'
import type { AiServices } from '../ai'
import type { CoreEnv } from '../config/env'
import { curriculumJobHandlers } from '../curriculum/service'
import type { Db } from '../db/client'
import { imageJobHandler } from '../images'
import { defineJobHandler, type JobHandler } from '../jobs/runtime'
import { studyHandlers } from '../study/process'
import { researchJobHandlers } from '../research/jobs'

/** Services handlers may need beyond the per-job tools (db/log/signal/progress). */
export interface HandlerDeps {
  db: Db
  env: CoreEnv
  ai: AiServices
  log: Logger
}

/** The worker's job handler registry. Each domain contributes its handlers here. */
export function jobHandlers(deps: HandlerDeps): JobHandler[] {
  return [
    defineJobHandler('curriculum.sync', async (_job, tools) => {
      await curriculumJobHandlers['curriculum.sync'](tools.db, tools.log)
    }),
    imageJobHandler({ ai: deps.ai, dataDir: deps.env.DATA_DIR }),
    ...studyHandlers(deps),
    ...researchJobHandlers(deps),
  ]
}
