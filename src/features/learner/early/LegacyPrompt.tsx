import type { AppState } from '../../../core/types'
import { isUnlocked, VEHICLES } from '../../../content/vehicles'
import { claimLegacy, declineLegacy } from '../../../store/legacy'
import { actions } from '../../../store/store'
import { Button } from '../../../ui/Button'
import { useLearner } from '../context'
import { Frame } from '../Frame'
import styles from '../learner.module.css'

/** Adult-facing, once per device: move the old app's progress to this learner. The old copy is kept. */
export function LegacyPrompt({ offer, onDone }: { offer: AppState; onDone: () => void }) {
  const { learner } = useLearner()
  const missions = Object.values(offer.missions).reduce((a, b) => a + b, 0)
  const vehicles = VEHICLES.filter((v) => isUnlocked(v, offer.missions)).length
  return (
    <Frame title="Sparade framsteg" home={false}>
      <section className={styles.panel} aria-labelledby="legacy-q">
        <h2 id="legacy-q" className={styles.question}>
          Till en vuxen
        </h2>
        <p>
          Den här enheten har sparade framsteg från den tidigare JackApp: {missions} uppdrag och {vehicles} fordon i
          samlingen. Vill du flytta dem till {learner.displayName}?
        </p>
        <p className={styles.muted}>
          Den gamla kopian ligger kvar på enheten tills en vuxen har sparat den på servern.
        </p>
        <div className={styles.row}>
          <Button
            icon="check"
            onClick={() => {
              actions.adoptLegacy(offer)
              claimLegacy(learner.id)
              onDone()
            }}
          >
            Ja, flytta till {learner.displayName}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              declineLegacy(learner.id)
              onDone()
            }}
          >
            Nej, börja från början
          </Button>
        </div>
      </section>
    </Frame>
  )
}
