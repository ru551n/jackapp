import { useEffect, useRef } from 'react'
import type { JobStatus } from '../../../shared/contracts'
import { useJob } from '../../api/useJob'
import { Button } from '../../ui/Button'
import type { Variant } from '../runs/presentation'
import styles from './study.module.css'

interface Props {
  jobId: string
  variant: Variant
  /** Shown until the job reports its own step. */
  label: string
  onCompleted?: (job: JobStatus) => void
  /** Offered after a failure; the API decides whether it is allowed. */
  onRetry?: () => void
}

/** Calm progress for a background job ("Läser sida 3 av 12 …"), announced politely. */
export function JobProgress({ jobId, variant, label, onCompleted, onRetry }: Props) {
  const job = useJob(jobId)
  const reported = useRef(false)
  useEffect(() => {
    if (job?.state === 'completed' && !reported.current) {
      reported.current = true
      onCompleted?.(job)
    }
  }, [job, onCompleted])

  if (job?.state === 'failed' || job?.state === 'cancelled') {
    const msg =
      variant === 'adult'
        ? (job.error?.adultMessage ?? 'Det gick inte att slutföra.')
        : (job.error?.learnerMessage ?? 'Det gick inte att skapa uppgiften just nu.')
    return (
      <div className={styles.calmBox} role="status">
        <p>{msg}</p>
        {onRetry && (
          <Button variant="secondary" onClick={onRetry}>
            Försök igen
          </Button>
        )}
      </div>
    )
  }
  const step = job?.state === 'completed' ? 'Klart' : (job?.step ?? label)
  return (
    <div className={styles.job}>
      <p role="status" aria-live="polite">
        {step.endsWith('…') || job?.state === 'completed' ? step : `${step} …`}
      </p>
      <progress max={1} value={job?.progress ?? 0} aria-label={step} />
    </div>
  )
}
