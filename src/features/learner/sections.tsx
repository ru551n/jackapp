import { useState } from 'react'
import { Link } from 'react-router'
import type { StudySet } from '../../../shared/contracts'
import { usePaths } from '../../app/paths'
import { Button } from '../../ui/Button'
import { learnerApi, TYPE_LABEL, type ArtifactSummary, type Subject } from './api'
import { useFetch, useLearner } from './context'
import { Creator } from './requests'
import styles from './learner.module.css'

// Building blocks for the middle and upper dashboards.

export function Panel({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  const id = `p-${title.replace(/\W+/g, '-')}`
  return (
    <section className={`${styles.panel} ${wide ? styles.wide : ''}`} aria-labelledby={id}>
      <h2 id={id} className={styles.panelTitle}>
        {title}
      </h2>
      {children}
    </section>
  )
}

/** Approved material, filterable by the subjects it covers. */
export function Library({ subjects }: { subjects?: Subject[] | null }) {
  const { learner } = useLearner()
  const paths = usePaths()
  const [subject, setSubject] = useState<string>()
  const all = useFetch<ArtifactSummary[]>(() => learnerApi.artifacts(learner.id), `artifacts:${learner.id}`)
  const list = all?.filter((a) => !subject || a.subjectCode === subject)
  const name = (code?: string | null) => subjects?.find((s) => s.code === code)?.name
  const covered = [...new Set(all?.map((a) => a.subjectCode).filter((c): c is string => !!c && !!name(c)))]
  if (all === undefined) return null
  if (!list?.length) return <p className={styles.muted}>Inget material här än.</p>
  return (
    <>
      {covered.length > 1 && (
        <div className={styles.chips} role="group" aria-label="Visa material för ämne">
          {covered.map((c) => (
            <button
              key={c}
              type="button"
              className={styles.chip}
              aria-pressed={subject === c}
              onClick={() => setSubject(subject === c ? undefined : c)}
            >
              {name(c)}
            </button>
          ))}
        </div>
      )}
      <ul className={styles.list}>
        {list.map((a) => (
          <li key={a.id}>
            <Link to={paths.material(a.id)} className={styles.item}>
              <span>{a.title}</span>
              <span className={styles.muted}>
                {[TYPE_LABEL[a.type], name(a.subjectCode)].filter(Boolean).join(' · ')}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}

/** Subjects for the learner's year, folded away (the list is long). */
export function YearSubjects({ subjects }: { subjects?: Subject[] | null }) {
  const { learner } = useLearner()
  if (!subjects?.length) return null
  const year = learner.school.stage === 'gymnasieskola' ? `år ${learner.school.year}` : `årskurs ${learner.school.year}`
  return (
    <details>
      <summary>Alla ämnen i {year}</summary>
      <ul className={styles.columns}>
        {subjects.map((s) => (
          <li key={s.code}>{s.name}</li>
        ))}
      </ul>
    </details>
  )
}

/** Material an adult uploaded; learners cannot upload (adult-only API), but can practise on it. */
export function StudySets({ action }: { action: string }) {
  const { learner } = useLearner()
  const sets = useFetch<StudySet[]>(() => learnerApi.studySets(learner.id), `sets:${learner.id}`)
  const ready = sets?.filter((s) => s.status === 'ready') ?? []
  return (
    <>
      <p className={styles.muted}>Be en vuxen ladda upp bilder eller PDF:er på det du ska plugga.</p>
      {ready.length > 0 && learner.learnerRequestsAllowed && (
        <Creator>
          {(submit) => (
            <ul className={styles.list}>
              {ready.map((s) => (
                <li key={s.id} className={styles.item}>
                  <span>{s.title || 'Uppladdat material'}</span>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      submit(() => learnerApi.generate(learner.id, { type: 'practiceTest', studySetId: s.id }))
                    }
                  >
                    {action}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Creator>
      )}
    </>
  )
}
