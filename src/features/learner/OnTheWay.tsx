import { Link } from 'react-router'
import type { CreationJob } from '../../../shared/contracts'
import { usePaths } from '../../app/paths'
import { isActive, useCreationJobs } from '../../api/useCreationJobs'
import { CALM_FAILURE } from './api'
import { useLearner } from './context'
import { Panel } from './sections'
import styles from './learner.module.css'

const SHOWN = 5

function status(j: CreationJob): string {
  if (isActive(j)) return 'Skapas …'
  if (j.state !== 'completed') return CALM_FAILURE
  return j.approval === 'approved' ? 'Klart' : 'En vuxen tittar på det först'
}

/** "På gång": the learner's own requests and practice tests, so leaving a page never loses them. */
export function OnTheWay() {
  const { learner } = useLearner()
  const paths = usePaths()
  // Rejected material just leaves the list; there is nothing for the learner to do about it.
  const jobs = useCreationJobs(learner.id)
    ?.filter((j) => j.approval !== 'rejected')
    .slice(0, SHOWN)
  if (!jobs?.length) return null
  return (
    <Panel title="På gång">
      <ul className={styles.list}>
        {jobs.map((j) => (
          <li key={j.id} className={styles.item}>
            <span>{j.title}</span>
            {j.state === 'completed' && j.approval === 'approved' && j.artifactId ? (
              <Link to={paths.material(j.artifactId)}>Klart – öppna</Link>
            ) : (
              <span className={styles.muted} role={isActive(j) ? 'status' : undefined}>
                {status(j)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  )
}
