import { RunPlayer } from '../runs'
import { useState } from 'react'
import { useParams } from 'react-router'
import { usePaths } from '../../app/paths'
import { VehicleArt } from '../../art/vehicles'
import type { Vehicle } from '../../core/types'
import { newlyUnlocked } from '../../content/vehicles'
import { actions, getState } from '../../store/store'
import { LinkButton } from '../../ui/Button'
import { learnerApi } from './api'
import { useFetch, useLearner } from './context'
import { areaForSubject } from './early/subjects'
import { Frame } from './Frame'
import styles from './learner.module.css'

/** One approved AI material, run in the band's presentation. Early: finishing counts toward the collection. */
export function MaterialPage() {
  const { artifactId = '' } = useParams()
  const { learner, flags } = useLearner()
  const paths = usePaths()
  const data = useFetch(() => learnerApi.artifact(artifactId), artifactId)
  const [unlocked, setUnlocked] = useState<Vehicle[] | null>(null)
  const title = data?.artifact.title ?? (flags.band === 'early' ? 'Uppdrag' : 'Material')

  const onFinish = () => {
    if (flags.band !== 'early') return
    const before = getState().missions
    actions.addMission(areaForSubject(data?.artifact.subjectCode))
    setUnlocked(newlyUnlocked(before, getState().missions))
  }

  return (
    <Frame title={title}>
      {data === null ? (
        <p className={styles.lead}>Det här uppdraget går inte att öppna just nu.</p>
      ) : unlocked ? (
        <section className={styles.panel}>
          <p className={styles.lead}>Bra jobbat! Uppdraget är klart.</p>
          {unlocked.map((v) => (
            <div key={v.id} className={styles.unlock}>
              <VehicleArt vehicle={v} className={styles.unlockArt} />
              <p>
                Ny i din samling: <strong>{v.shortName}</strong>
              </p>
            </div>
          ))}
          <LinkButton to={paths.home} variant="secondary" icon="home">
            Hem
          </LinkButton>
        </section>
      ) : (
        data && <RunSlot learnerId={learner.id} artifactId={artifactId} band={flags.band} onFinish={onFinish} />
      )}
    </Frame>
  )
}

/** Runs the material with the shared player in the learner's band and presentation. */
function RunSlot(props: { learnerId: string; artifactId: string; band: string; onFinish: () => void }) {
  const { learner } = useLearner()
  const variant = props.band === 'upper' ? 'upper' : props.band === 'middle' ? 'middle' : 'early'
  return (
    <RunPlayer
      learnerId={props.learnerId}
      artifactId={props.artifactId}
      variant={variant}
      presentation={learner.presentation}
      onFinished={() => props.onFinish()}
    />
  )
}
