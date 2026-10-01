import type { AreaId } from '../core/types'

export const paths = {
  home: '/',
  area: (area: AreaId) => `/omrade/${area}`,
  session: (area: AreaId) => `/omrade/${area}/uppdrag`,
  collection: '/samling',
  vehicle: (id: string) => `/samling/${id}`,
  parent: '/vuxen',
  freePlay: '/bygg',
}
