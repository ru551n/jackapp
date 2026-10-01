import { Navigate, useParams } from 'react-router'
import { usePaths } from '../../app/paths'
import { Sprite } from '../../art/sprites'
import { areaById } from '../../core/catalog'
import { missionsLeftText } from '../../core/swedish'
import { nextUnlock } from '../../content/vehicles'
import { useAppState } from '../../store/store'
import { LinkButton } from '../../ui/Button'
import { Shell } from '../../ui/Shell'
import { SESSION_LENGTH } from '../../engine/session'
import { AREA_SPRITE } from '../home/areaArt'
import styles from './AreaPage.module.css'

/** The "Start" step: one obvious action. */
export function AreaPage() {
  const paths = usePaths()
  const { area: areaParam = '' } = useParams()
  const area = areaById(areaParam)
  const missions = useAppState((s) => s.missions)
  if (!area) return <Navigate to={paths.home} replace />
  const upcoming = nextUnlock(area.id, missions)

  return (
    <Shell title={area.name}>
      <section className={styles.start}>
        <Sprite id={AREA_SPRITE[area.id]} className={styles.art} />
        <p className={styles.tagline}>{area.tagline}</p>
        <p className={styles.info}>Ett uppdrag är {SESSION_LENGTH} korta uppgifter.</p>
        <LinkButton to={paths.session(area.id)} icon="arrow">
          Starta uppdrag
        </LinkButton>
        {upcoming && <p className={styles.info}>{missionsLeftText(upcoming.remaining, upcoming.vehicle.shortName)}</p>}
      </section>
    </Shell>
  )
}
