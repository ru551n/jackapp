import type { RouteModule } from './context'
import { jobRoutes } from '../jobs/routes'
import { learnerRoutes } from '../learners/routes'

// Route registry: each domain exports one RouteModule and adds one line here.
export const ROUTE_MODULES: RouteModule[] = [learnerRoutes, jobRoutes]
