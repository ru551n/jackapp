import { useEffect, useState } from 'react'
import type { StudySet } from '../../../shared/contracts'
import { api } from '../../api/client'
import { errorText, STATUS_LABEL, type CommonProps } from '../runs/presentation'
import styles from './study.module.css'

export interface StudySetListProps extends CommonProps {
  onOpen?: (setId: string) => void
  /** Change to reload (e.g. after an upload). */
  refreshKey?: unknown
}

const busy = (s: StudySet) => s.status === 'uploading' || s.status === 'queued' || s.status === 'processing'

export function StudySetList({ learnerId, variant, onOpen, refreshKey }: StudySetListProps) {
  const [sets, setSets] = useState<StudySet[]>()
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout>
    const load = () =>
      api
        .get<StudySet[]>(`/learners/${learnerId}/study-sets`)
        .then((list) => {
          if (!live) return
          setSets(list)
          if (list.some(busy)) timer = setTimeout(load, 3000) // calm polling while something is being read
        })
        .catch((e) => live && setError(errorText(variant, e, 'Materialet gick inte att hämta just nu.')))
    void load()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [learnerId, variant, refreshKey])

  if (error) return <p className={styles.note}>{error}</p>
  if (!sets) return <p className={styles.note}>Hämtar material …</p>
  if (!sets.length) return <p className={styles.note}>Inget uppladdat material än.</p>

  return (
    <ul className={styles.setList} data-variant={variant} aria-label="Studiematerial">
      {sets.map((s) => (
        <li key={s.id}>
          <button type="button" className={styles.setCard} onClick={() => onOpen?.(s.id)}>
            <span className={styles.setTitle}>{s.title}</span>
            <span className={styles.note}>
              {s.pages.length} {s.pages.length === 1 ? 'sida' : 'sidor'} ·{' '}
              {new Date(s.createdAt).toLocaleDateString('sv-SE')}
            </span>
            <span className={styles.status} data-status={s.status}>
              {STATUS_LABEL[s.status]}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
