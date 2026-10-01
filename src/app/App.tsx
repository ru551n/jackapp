import { useEffect } from 'react'
import { createHashRouter, RouterProvider } from 'react-router'
import { CollectionPage } from '../features/collection/CollectionPage'
import { VehicleDetailPage } from '../features/collection/VehicleDetailPage'
import { FreePlayPage } from '../features/freeplay/FreePlayPage'
import { HomePage } from '../features/home/HomePage'
import { ParentPage } from '../features/parent/ParentPage'
import { AreaPage } from '../features/session/AreaPage'
import { SessionPage } from '../features/session/SessionPage'
import { useAppState } from '../store/store'

// Hash routing: works from any static host or file server without rewrite rules.
const routes = [
  { path: '/', element: <HomePage /> },
  { path: '/omrade/:area', element: <AreaPage /> },
  { path: '/omrade/:area/uppdrag', element: <SessionPage /> },
  { path: '/samling', element: <CollectionPage /> },
  { path: '/samling/:id', element: <VehicleDetailPage /> },
  { path: '/vuxen', element: <ParentPage /> },
  { path: '/bygg', element: <FreePlayPage /> },
  { path: '*', element: <HomePage /> },
]

const router = createHashRouter(routes)

export function App() {
  // Mirror the motion setting onto <html data-motion> for the global CSS rules.
  const motion = useAppState((s) => s.settings.motion)
  useEffect(() => {
    if (motion === 'system') delete document.documentElement.dataset.motion
    else document.documentElement.dataset.motion = motion
  }, [motion])
  return <RouterProvider router={router} />
}
