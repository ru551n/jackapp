import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import type { CreationJob } from '../../../shared/contracts'
import { isActive, jobsChanged, useCreationJobs, useJobList } from '../../api/useCreationJobs'
import { Button } from '../../ui/Button'
import { adultApi, errorText, paths, useResource, type LearnerListItem } from './api'
import { useLearner } from './context'
import { formatDate } from './labels'
import { Page } from './Page'
import s from './adult.module.css'

// What is being made right now: per learner on the Material page, household-wide on /vuxen/pagar.

function chip(j: CreationJob): string {
  if (j.state === 'queued') return 'I kö'
  if (j.state === 'processing') return `Skapas … ${Math.round(j.progress * 100)} %`
  if (j.state === 'failed') return 'Gick inte att skapa'
  if (j.state === 'cancelled') return 'Avbruten'
  return j.approval === 'pendingApproval' || j.approval === 'draft' ? 'Klar – väntar på godkännande' : 'Klar'
}

const chipClass = (j: CreationJob) =>
  j.state !== 'completed'
    ? ''
    : (s[j.approval === 'approved' || !j.approval ? 'ap_approved' : 'ap_pendingApproval'] ?? '')

function JobRows({ jobs, names }: { jobs: CreationJob[]; names?: Map<string, string> }) {
  const [msg, setMsg] = useState('')
  const retry = (id: string) =>
    adultApi.post(`/jobs/${id}/retry`).then(jobsChanged, (e: unknown) => setMsg(errorText(e)))
  return (
    <>
      <ul className={s.list}>
        {jobs.map((j) => {
          const base = `/vuxen/elev/${j.learnerId}`
          const title = names ? `${names.get(j.learnerId ?? '') ?? 'Elev'}: ${j.title}` : j.title
          return (
            <li key={j.id} className={s.listRow}>
              {j.state === 'completed' && j.artifactId ? (
                <Link to={`${base}/material/${j.artifactId}`}>{title}</Link>
              ) : j.state === 'completed' && j.type === 'study.process' ? (
                <Link to={`${base}/studiematerial`}>{title}</Link>
              ) : (
                <span>{title}</span>
              )}
              <span className={s.muted}>
                {formatDate(j.createdAt)}
                {j.createdBy === 'learner' ? ' · önskat av eleven' : ''}
              </span>
              <span className={`${s.badge} ${chipClass(j)}`}>{chip(j)}</span>
              {j.state === 'failed' && (
                <div className={s.rowNote}>
                  <p className={s.muted}>{j.error?.adultMessage}</p>
                  {j.error?.retryable && (
                    <Button variant="secondary" onClick={() => void retry(j.id)}>
                      Försök igen
                    </Button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <p role="status" className={s.msg}>
        {msg}
      </p>
    </>
  )
}

/** "Pågår och klart" on a learner's Material page. `onFinished` runs when a job ends. */
export function Creations({ onFinished }: { onFinished?: () => void }) {
  const { learner } = useLearner()
  const jobs = useCreationJobs(learner.id)
  const active = jobs?.filter(isActive).length
  const prev = useRef(active)
  useEffect(() => {
    if (active !== undefined && prev.current !== undefined && active < prev.current) onFinished?.()
    prev.current = active
  }, [active, onFinished])
  if (!jobs?.length) return null
  return (
    <section className={s.card} aria-labelledby="creations-h">
      <h2 id="creations-h">Pågår och klart</h2>
      <JobRows jobs={jobs} />
    </section>
  )
}

/** `/vuxen/pagar`: every learner's creations in one list. */
export function HouseholdJobs() {
  const jobs = useJobList('/jobs', { activeMs: 5000 })
  const learners = useResource<LearnerListItem[]>(paths.learners)
  const names = new Map(learners.data?.map((l) => [l.id, l.displayName]))
  return (
    <Page title="Pågår och klart">
      <p className={s.crumb}>
        <Link to="/vuxen">Översikt</Link>
      </p>
      {jobs?.length === 0 && <p className={s.muted}>Inget har skapats på sistone.</p>}
      {jobs === undefined && (
        <p role="status" className={s.muted}>
          Hämtar …
        </p>
      )}
      {!!jobs?.length && <JobRows jobs={jobs} names={names} />}
    </Page>
  )
}

/** Small count of material being made for one learner, for tabs and overview cards. */
export function ActiveCount({ learnerId }: { learnerId: string }) {
  const n = useCreationJobs(learnerId, true)?.length
  return n ? <span className={s.badge}>{n} skapas</span> : null
}

/** Header indicator: "Skapas: 2" across the household, linking to /vuxen/pagar. */
export function CreatingIndicator() {
  const n = useJobList('/jobs?active=1', { activeMs: 5000, idleMs: 30_000 })?.length
  return n ? (
    <Link to="/vuxen/pagar" className={`${s.badge} ${s.creating}`}>
      Skapas: {n}
    </Link>
  ) : null
}
