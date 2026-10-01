import { useContext, type ReactNode } from 'react'
import { Button } from '../../ui/Button'
import { Shell } from '../../ui/Shell'
import { LockContext } from './context'
import { CreatingIndicator } from './Creations'
import s from './adult.module.css'

/** Frame for every adult screen: the shared Shell with a "Lås" button. */
export function Page({ title, children }: { title: string; children: ReactNode }) {
  const lock = useContext(LockContext)
  return (
    <div className={s.adult}>
      <Shell
        title={title}
        right={
          lock && (
            <>
              <CreatingIndicator />
              <Button variant="secondary" icon="lock" className={s.lockButton} onClick={lock}>
                Lås
              </Button>
            </>
          )
        }
      >
        {children}
      </Shell>
    </div>
  )
}
