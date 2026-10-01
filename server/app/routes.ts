import type { RouteModule } from './context'
import { systemStatusRoutes } from '../ai/routes'
import { assetRoutes } from '../assets/routes'
import { curriculumRoutes } from '../curriculum/routes'
import { imageRoutes } from '../images/routes'
import { jobRoutes } from '../jobs/routes'
import { learnerRoutes } from '../learners/routes'
import { studyRoutes } from '../study/routes'
import { runRoutes } from '../runs/routes'
import { researchRoutes } from '../research/routes'

// Route registry: each domain exports one RouteModule and adds one line here.
export const ROUTE_MODULES: RouteModule[] = [
  systemStatusRoutes,
  assetRoutes,
  learnerRoutes,
  jobRoutes,
  curriculumRoutes,
  imageRoutes,
  studyRoutes,
  runRoutes,
  researchRoutes,
]
