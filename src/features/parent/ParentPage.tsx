import { useNavigate } from 'react-router'
import { useState } from 'react'
import { paths } from '../../app/paths'
import { Button } from '../../ui/Button'
import { Shell } from '../../ui/Shell'
import { Dashboard } from './Dashboard'
import { DataPanel } from './DataPanel'
import { Gate } from './Gate'
import { Settings } from './Settings'
import s from './parent.module.css'

export function ParentPage() {
  // In-memory only: leaving the page unmounts it and re-locks.
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  return (
    <Shell title="För vuxna">
      <div className={s.wrap}>
        {open ? (
          <>
            <div>
              <Button variant="secondary" onClick={() => navigate(paths.home)}>
                Lås och gå tillbaka
              </Button>
            </div>
            <Dashboard />
            <Settings />
            <DataPanel />
          </>
        ) : (
          <Gate onUnlock={() => setOpen(true)} />
        )}
      </div>
    </Shell>
  )
}
