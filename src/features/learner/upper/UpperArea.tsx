import { useState } from 'react'
import { Navigate, Route, Routes } from 'react-router'
import type { ItemKind, StudySet } from '../../../../shared/contracts'
import { usePaths } from '../../../app/paths'
import { Button } from '../../../ui/Button'
import { learnerApi, type LearnerRequest } from '../api'
import { useFetch, useLearner, useSubjects } from '../context'
import { Frame } from '../Frame'
import { OnTheWay } from '../OnTheWay'
import { MaterialPage } from '../MaterialPage'
import { Creator, FreeRequest, RequestPage } from '../requests'
import { Library, Panel, StudySets, YearSubjects } from '../sections'
import styles from '../learner.module.css'

// Gymnasium: a plain, efficient study dashboard. No collection, no mascots.

const UPPER_CHIPS = [
  'Förhör mig på fotosyntesen',
  'Hjälp mig plugga till historiaprovet',
  'Förklara derivata steg för steg',
]

/** The first chip follows the learner's first interest, when there is one. */
const upperChips = (interests: string[] = []) => {
  const a = interests
    .find((i) => i.trim())
    ?.trim()
    .toLowerCase()
  return a ? [`Förklara något om ${a} steg för steg`, ...UPPER_CHIPS.slice(0, 2)] : UPPER_CHIPS
}

export function UpperArea() {
  const paths = usePaths()
  const { learner } = useLearner()
  return (
    <Routes>
      <Route index element={<UpperHome />} />
      <Route path="material/:artifactId" element={<MaterialPage />} />
      <Route path="onska" element={<RequestPage chips={upperChips(learner.interests)} />} />
      <Route path="*" element={<Navigate to={paths.home} replace />} />
    </Routes>
  )
}

function UpperHome() {
  const { learner } = useLearner()
  const subjects = useSubjects()
  const allowed = learner.learnerRequestsAllowed
  return (
    <Frame title="Översikt" home={false}>
      <div className={styles.grid}>
        <OnTheWay />
        <Panel title="Plugga">
          {allowed ? (
            <Creator>
              {(submit) => (
                <FreeRequest
                  chips={upperChips(learner.interests)}
                  onSubmit={(r) => submit(() => learnerApi.generate(learner.id, r))}
                />
              )}
            </Creator>
          ) : (
            <p className={styles.muted}>Be en vuxen om nytt material.</p>
          )}
        </Panel>
        {allowed && (
          <Panel title="Skapa övningsprov">
            <TestForm />
          </Panel>
        )}
        <Panel title="Studiematerial">
          <StudySets action="Övningsprov" />
        </Panel>
        <Panel title="Material och resultat" wide>
          <Library subjects={subjects} />
          <p className={styles.muted}>Resultat per fråga visas när du lämnar in ett prov.</p>
        </Panel>
        <Panel title="Kurser och ämnen" wide>
          <YearSubjects subjects={subjects} />
        </Panel>
      </div>
    </Frame>
  )
}

const KINDS: [ItemKind, string][] = [
  ['multipleChoice', 'Flerval'],
  ['trueFalse', 'Sant/falskt'],
  ['fillBlank', 'Lucktext'],
  ['matching', 'Para ihop'],
  ['numeric', 'Tal'],
  ['freeText', 'Fritext'],
]
const LEVELS = ['Grundläggande', 'Lätt', 'Medel', 'Utmanande', 'Svår']

const useReadySets = () => {
  const { learner } = useLearner()
  const sets = useFetch<StudySet[]>(() => learnerApi.studySets(learner.id), `sets:${learner.id}`)
  return sets?.filter((s) => s.status === 'ready') ?? []
}

/** Practice test or revision from material: count, difficulty, item types and feedback mode. */
export function TestForm() {
  const { learner } = useLearner()
  const sets = useReadySets()
  const subjects = useSubjects()
  const [kinds, setKinds] = useState<ItemKind[]>([])
  return (
    <Creator>
      {(submit) => (
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault()
            const f = new FormData(e.currentTarget)
            const str = (k: string) => (f.get(k) as string) || undefined
            const req: LearnerRequest = {
              type: f.get('type') === 'revision' ? 'revision' : 'practiceTest',
              studySetId: str('set'),
              subjectCode: str('subject'),
              topic: str('topic'),
              questionCount: Number(f.get('count')),
              difficulty: Number(f.get('level')),
              feedback: f.get('feedback') === 'end' ? 'end' : 'immediate',
              ...(kinds.length ? { itemKinds: kinds } : {}),
            }
            submit(() => learnerApi.generate(learner.id, req))
          }}
        >
          <div className={styles.fields}>
            <label>
              Typ
              <select name="type" className={styles.input}>
                <option value="practiceTest">Övningsprov</option>
                <option value="revision">Repetition</option>
              </select>
            </label>
            <label>
              Material
              <select name="set" className={styles.input}>
                <option value="">Inget uppladdat</option>
                {sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title || 'Uppladdat material'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Ämne
              <select name="subject" className={styles.input}>
                <option value="">Valfritt</option>
                {(subjects ?? []).map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Område
              <input name="topic" className={styles.input} maxLength={300} placeholder="t.ex. fotosyntes" />
            </label>
            <label>
              Antal frågor
              <input name="count" type="number" className={styles.input} min={3} max={40} defaultValue={12} />
            </label>
            <label>
              Svårighet
              <select name="level" className={styles.input} defaultValue="3">
                {LEVELS.map((l, i) => (
                  <option key={l} value={i + 1}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className={styles.fieldset}>
            <legend>Frågetyper (alla om inget är valt)</legend>
            {KINDS.map(([k, label]) => (
              <label key={k} className={styles.check}>
                <input
                  type="checkbox"
                  checked={kinds.includes(k)}
                  onChange={(e) => setKinds(e.target.checked ? [...kinds, k] : kinds.filter((x) => x !== k))}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <fieldset className={styles.fieldset}>
            <legend>Återkoppling</legend>
            <label className={styles.check}>
              <input type="radio" name="feedback" value="immediate" defaultChecked /> Efter varje fråga
            </label>
            <label className={styles.check}>
              <input type="radio" name="feedback" value="end" /> I slutet, som ett riktigt prov
            </label>
          </fieldset>
          <div className={styles.row}>
            <Button type="submit">Skapa</Button>
          </div>
        </form>
      )}
    </Creator>
  )
}
