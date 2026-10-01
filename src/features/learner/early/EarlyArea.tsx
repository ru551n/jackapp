import { useState } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router'
import { usePaths } from '../../../app/paths'
import { Sprite } from '../../../art/sprites'
import { CollectionPage } from '../../collection/CollectionPage'
import { VehicleDetailPage } from '../../collection/VehicleDetailPage'
import { FreePlayPage } from '../../freeplay/FreePlayPage'
import { Destination, HomePage } from '../../home/HomePage'
import { AreaPage } from '../../session/AreaPage'
import { SessionPage } from '../../session/SessionPage'
import { legacyOffer } from '../../../store/legacy'
import { learnerApi, type ArtifactSummary } from '../api'
import { useFetch, useLearner } from '../context'
import { MaterialPage } from '../MaterialPage'
import { RequestPage } from '../requests'
import { Frame } from '../Frame'
import { LegacyPrompt } from './LegacyPrompt'
import { EARLY_SUBJECTS, themeOptions } from './subjects'
import styles from '../learner.module.css'

/** F–3: the original JackApp, per learner, plus calm AI missions. */
export function EarlyArea() {
  const { learner } = useLearner()
  const paths = usePaths()
  const [offer, setOffer] = useState(() => legacyOffer(learner.id))
  if (offer) return <LegacyPrompt offer={offer} onDone={() => setOffer(null)} />
  return (
    <Routes>
      <Route index element={<EarlyHome />} />
      <Route path="omrade/:area" element={<AreaPage />} />
      <Route path="omrade/:area/uppdrag" element={<SessionPage />} />
      <Route path="samling" element={<CollectionPage />} />
      <Route path="samling/:id" element={<VehicleDetailPage />} />
      <Route path="bygg" element={<FreePlayPage />} />
      <Route path="material" element={<Missions />} />
      <Route path="material/:artifactId" element={<MaterialPage />} />
      <Route
        path="onska"
        element={
          <RequestPage
            guided={{ subjects: EARLY_SUBJECTS, themes: themeOptions(learner.interests ?? learner.themes) }}
          />
        }
      />
      <Route path="*" element={<Navigate to={paths.home} replace />} />
    </Routes>
  )
}

const useMissions = (id: string) => useFetch<ArtifactSummary[]>(() => learnerApi.artifacts(id), `artifacts:${id}`)

function EarlyHome() {
  const { learner } = useLearner()
  const paths = usePaths()
  const missions = useMissions(learner.id)
  const { reducedVisualComplexity, maxChoices } = learner.presentation
  // "Enklare skärmbild" or few choices: fewer tiles at once, the rest behind "Mer".
  const max = reducedVisualComplexity || maxChoices < 4 ? Math.max(maxChoices, 3) : undefined
  return (
    <HomePage
      max={max}
      lead={
        !!missions?.length && (
          <Destination
            to={paths.materials}
            sprite="suitcase"
            name="Nya uppdrag"
            tagline={missions.length === 1 ? 'Ett uppdrag väntar' : `${missions.length} uppdrag väntar`}
            variant="collection"
          />
        )
      }
    >
      {learner.learnerRequestsAllowed && (
        <Destination to={paths.request} sprite="passenger" name="Önska uppdrag" tagline="Välj vad du vill öva på" />
      )}
    </HomePage>
  )
}

/** "Nya uppdrag": approved AI material as large, calm cards. */
function Missions() {
  const { learner } = useLearner()
  const paths = usePaths()
  const missions = useMissions(learner.id)
  return (
    <Frame title="Nya uppdrag">
      {missions === undefined ? null : !missions?.length ? (
        <p className={styles.lead}>Här finns inga nya uppdrag just nu.</p>
      ) : (
        <ul className={styles.cards}>
          {missions.map((m) => (
            <li key={m.id}>
              <Link to={paths.material(m.id)} className={styles.missionCard}>
                <Sprite
                  id={EARLY_SUBJECTS.find((s) => s.id === m.subjectCode)?.sprite ?? 'suitcase'}
                  className={styles.choiceArt}
                />
                <span>{m.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Frame>
  )
}
