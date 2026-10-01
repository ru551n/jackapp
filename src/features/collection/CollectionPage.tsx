import { Link } from 'react-router'
import { paths } from '../../app/paths'
import { VehicleArt } from '../../art/vehicles'
import { isUnlocked, VEHICLES } from '../../content/vehicles'
import { useAppState } from '../../store/store'
import { Shell } from '../../ui/Shell'
import styles from './Collection.module.css'
import { remainingText, SECTIONS } from './remaining'

export function CollectionPage() {
  const missions = useAppState((s) => s.missions)
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
                  <li key={v.id} className={`${styles.card} ${styles.locked}`}>
                    <div aria-hidden="true" className={styles.lockedArt}>
                      <VehicleArt vehicle={v} mode="silhouette" className={styles.art} />
                    </div>
                    <span className={styles.name}>
                      <span aria-hidden="true">?</span>
                      <span className={styles.visuallyHidden}>Ett fordon som är låst</span>
                    </span>
                    <span className={styles.hint}>{remainingText(v, missions)}</span>
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
