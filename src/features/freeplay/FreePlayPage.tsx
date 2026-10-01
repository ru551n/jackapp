import { Navigate } from 'react-router'
import { paths } from '../../app/paths'
import { useAppState } from '../../store/store'
import { Shell } from '../../ui/Shell'

// Placeholder: replaced by the free-play milestone. Locked unless a parent enabled it.
export function FreePlayPage() {
  const enabled = useAppState((s) => s.settings.freePlayEnabled)
  if (!enabled) return <Navigate to={paths.home} replace />
  return (
    <Shell title="Bygg din linje">
      <p>Kommer snart.</p>
    </Shell>
  )
}
