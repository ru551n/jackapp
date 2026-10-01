import { useEffect, useRef } from 'react'
import type { JobStatus } from '../../../shared/contracts'
import { useJob } from '../../api/useJob'
import s from './adult.module.css'

const CALM: Record<JobStatus['state'], string> = {
  queued: 'Väntar på att få börja …',
  processing: 'Arbetar …',
  completed: 'Klart.',
  failed: 'Det gick inte den här gången.',
  cancelled: 'Avbrutet.',
}

/** Follows a job with calm text; calls onDone once when it ends. */
export function JobProgress({ jobId, onDone }: { jobId: string; onDone?: (s: JobStatus) => void }) {
  const status = useJob(jobId)
  const done = useRef(false)
  const final = status && ['completed', 'failed', 'cancelled'].includes(status.state)
  useEffect(() => {
    if (status && final && !done.current) {
      done.current = true
      onDone?.(status)
    }
  }, [status, final, onDone])

  return (
    <div className={s.job} role="status" aria-live="polite">
      {!final && <progress max={1} value={status?.progress || undefined} aria-label="Förlopp" />}
      <p>
        {status?.state === 'failed'
          ? (status.error?.adultMessage ?? CALM.failed)
          : status && !final && status.step
            ? status.step
            : CALM[status?.state ?? 'queued']}
      </p>
    </div>
  )
}
