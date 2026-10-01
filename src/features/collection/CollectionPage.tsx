import { Link } from 'react-router'
import type { Vehicle } from '../../core/types'
import { usePaths } from '../../app/paths'
import { VehicleArt } from '../../art/vehicles'
import { isUnlocked, VEHICLES } from '../../content/vehicles'
import { useAppState } from '../../store/store'
import { Shell } from '../../ui/Shell'
import styles from './Collection.module.css'
import { lockedHint, nextIds, SECTIONS } from './remaining'

export function CollectionPage() {
  const paths = usePaths()
  const missions = useAppState((s) => s.missions)
  const next = nextIds(VEHICLES, missions)
  const have = VEHICLES.filter((v) => isUnlocked(v, missions)).length
  return (
    <Shell title="Min samling">
      <p className={styles.total}>
        Du har {have} av {VEHICLES.length}
      </p>
      {SECTIONS.map(({ category, title }) => {
        const items = VEHICLES.filter((v) => v.category === category)
        if (items.length === 0) return null
        return (
          <section key={category} className={styles.section} aria-labelledby={`sec-${category}`}>
            <h2 id={`sec-${category}`} className={styles.heading}>
              {title}
            </h2>
            <ul className={styles.grid}>
              {items.map((v) =>
                isUnlocked(v, missions) ? (
                  <li key={v.id}>
                    <Link to={paths.vehicle(v.id)} className={styles.card}>
                      <VehicleArt vehicle={v} className={styles.art} />
                      <span className={styles.name}>{v.shortName}</span>
                    </Link>
                  </li>
                ) : (
                  <li key={v.id}>
                    <LockedCard v={v} hint={lockedHint(v, missions, next.has(v.id))} prominent={next.has(v.id)} />
                  </li>
                ),
              )}
            </ul>
          </section>
        )
      })}
    </Shell>
  )
}

function LockedCard({ v, hint, prominent }: { v: Vehicle; hint: string; prominent: boolean }) {
  const paths = usePaths()
  const body = (
    <>
      <div aria-hidden="true" className={styles.lockedArt}>
        <VehicleArt vehicle={v} mode="silhouette" className={styles.art} />
      </div>
      <span className={styles.name}>
        <span aria-hidden="true">?</span>
        <span className={styles.visuallyHidden}>Låst fordon. </span>
      </span>
      <span className={prominent ? styles.hintNext : styles.hint}>{hint}</span>
    </>
  )
  const cls = `${styles.card} ${styles.locked}`
  // 'any' unlocks from any area, so there is no single place to send the child.
  return v.unlock.area === 'any' ? (
    <div className={cls}>{body}</div>
  ) : (
    <Link to={paths.area(v.unlock.area)} className={cls}>
      {body}
    </Link>
  )
}
