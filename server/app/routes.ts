import type { RouteModule } from './context'
import { jobRoutes } from '../jobs/routes'

// Route registry: each domain exports one RouteModule and adds one line here.
export const ROUTE_MODULES: RouteModule[] = [jobRoutes]
