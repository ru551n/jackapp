import { curriculumRoutes } from '../curriculum/routes'
import type { RouteModule } from './context'

// Route registry: each domain exports one RouteModule and adds one line here.
export const ROUTE_MODULES: RouteModule[] = [curriculumRoutes]
