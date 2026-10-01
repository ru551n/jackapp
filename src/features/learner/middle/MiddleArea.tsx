import { Navigate, Route, Routes } from 'react-router'
import { usePaths } from '../../../app/paths'
import { LinkButton } from '../../../ui/Button'
import type { Subject } from '../api'
import { useLearner, useSubjects } from '../context'
import { Frame } from '../Frame'
import { MaterialPage } from '../MaterialPage'
import { RequestPage, type Option } from '../requests'
import { Library, Panel, PathsProgress, StudySets, Today, YearSubjects } from '../sections'
import styles from '../learner.module.css'

// Year 4–9: denser, more autonomy, meaningful (qualitative) progress, optional themes.

const MIDDLE_CHIPS = [
  'Jag vill lära mig bråk med flygplan',
  'Öva multiplikationstabellen',
  'Läsförståelse om rymden',
  'Engelska ord om djur',
]
const DEFAULT_THEMES = ['Tåg', 'Flygplan', 'Djur', 'Rymden', 'Sport', 'Musik']

// The guided path offers the core subjects first; the full list is long.
const CORE = [
  'GRGRMAT01',
  'GRGRSVE01',
  'GRGRENG01',
  'GRGRBIO01',
  'GRGRFYS01',
  'GRGRKEM01',
  'GRGRTEK01',
  'GRGRHIS01',
  'GRGRGEO01',
  'GRGRSAM01',
  'GRGRREL01',
]

function guidedSubjects(all: Subject[]): Option[] {
  const core = CORE.map((c) => all.find((s) => s.code === c)).filter((s): s is Subject => !!s)
  return (core.length ? core : all).map((s) => ({ id: s.code, label: s.name }))
}

export function MiddleArea() {
  const { learner } = useLearner()
  const paths = usePaths()
  const subjects = useSubjects()
  const themes = learner.interests?.length ? learner.interests : DEFAULT_THEMES
  const guided = {
    subjects: guidedSubjects(subjects ?? []),
    themes: [...themes.map<Option>((t) => ({ id: t, label: t })), { id: '', label: 'Inget tema' }],
  }
  return (
    <Routes>
      <Route index element={<MiddleHome />} />
      <Route path="material/:artifactId" element={<MaterialPage />} />
      <Route path="onska" element={<RequestPage guided={guided} chips={MIDDLE_CHIPS} themes={themes} />} />
      <Route path="*" element={<Navigate to={paths.home} replace />} />
    </Routes>
  )
}

function MiddleHome() {
  const { learner } = useLearner()
  const paths = usePaths()
  const subjects = useSubjects()
  return (
    <Frame title={`Hej ${learner.displayName}!`} home={false}>
      <div className={styles.grid}>
        <Today />
        <Panel title="Önska något nytt">
          <p data-secondary>Skriv vad du vill lära dig, eller välj steg för steg.</p>
          {learner.learnerRequestsAllowed ? (
            <LinkButton to={paths.request} icon="arrow">
              Önska uppdrag
            </LinkButton>
          ) : (
            <p className={styles.muted}>Be en vuxen om ett nytt uppdrag.</p>
          )}
        </Panel>
        <Panel title="Mitt material" wide>
          <Library subjects={subjects} />
          <YearSubjects subjects={subjects} />
        </Panel>
        <Panel title="Min väg framåt">
          <PathsProgress />
        </Panel>
        <Panel title="Prov på mina bilder">
          <StudySets action="Gör ett prov" />
        </Panel>
      </div>
    </Frame>
  )
}
