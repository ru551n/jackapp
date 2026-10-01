import { useEffect } from 'react'
import { createHashRouter, RouterProvider } from 'react-router'
import { AdultArea } from '../features/adult'
import { LearnerArea } from '../features/learner'
import { StartPage } from '../features/start'
import { useAppState } from '../store/store'

// Hash routing: works from any static host or file server without rewrite rules.
// `/` start (setup or learner picker), `/vuxen/*` adult area (PIN gate), `/l/:learnerId/*` learner area.
const routes = [
  { path: '/', element: <StartPage /> },
  { path: '/vuxen/*', element: <AdultArea /> },
  { path: '/l/:learnerId/*', element: <LearnerArea /> },
  { path: '*', element: <StartPage /> },
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
