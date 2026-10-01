import { useEffect, useRef } from 'react'
import { paths } from '../../app/paths'
import { VehicleArt } from '../../art/vehicles'
import { missionsLeftText } from '../../core/swedish'
import type { AreaId, Vehicle } from '../../core/types'
import { nextUnlock } from '../../content/vehicles'
import { useAppState } from '../../store/store'
import { Button, LinkButton } from '../../ui/Button'
import styles from './DonePanel.module.css'

/** "Klart!" — a calm, complete ending with a predictable next step. */
export function DonePanel({ area, unlocked, onAgain }: { area: AreaId; unlocked: Vehicle[]; onAgain: () => void }) {
  const missions = useAppState((s) => s.missions)
  const upcoming = nextUnlock(area, missions)
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => headingRef.current?.focus(), [])

  return (
    <section className={styles.done} aria-labelledby="done-title">
      <h2 id="done-title" ref={headingRef} tabIndex={-1} className={styles.title}>
        Bra jobbat! Uppdraget är klart.
      </h2>

      {unlocked.map((v) => (
        <div key={v.id} className={styles.unlock}>
          <VehicleArt vehicle={v} className={styles.art} />
          <p>
            Ny i din samling: <strong>{v.shortName}</strong>
          </p>
          <LinkButton to={paths.vehicle(v.id)} variant="secondary" icon="star">
            Titta på {v.shortName}
          </LinkButton>
        </div>
      ))}

      {upcoming && <p className={styles.next}>{missionsLeftText(upcoming.remaining, upcoming.vehicle.shortName)}</p>}

      <div className={styles.actions}>
        <Button icon="arrow" onClick={onAgain}>
          Ett uppdrag till
        </Button>
        <LinkButton to={paths.home} variant="secondary" icon="home">
          Hem
        </LinkButton>
      </div>
    </section>
  )
}
