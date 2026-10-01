import { useEffect, useState } from 'react'
import type { Artifact, Item } from '../../../shared/contracts'
import type { RunSummary } from '../../../server/runs/api'
import { api } from '../../api/client'
import { errorText, type CommonProps } from './presentation'
import styles from './runs.module.css'

export interface RunHistoryProps extends CommonProps {
  /** Only runs of this artifact. */
  artifactId?: string
}

interface HistoryAnswer {
  itemId: string
  attempt: number
  answer: unknown
  correct: boolean | null
  score: number | null
  revealed: boolean
  assessedBy: 'auto' | 'self' | 'ai' | 'pending'
  at: string
}
interface HistoryRun {
  id: string
  artifactId: string
  artifactVersion: number
  feedback: 'immediate' | 'end'
  state: 'active' | 'finished' | 'abandoned'
  startedAt: string
  finishedAt: string | null
  summary: RunSummary | null
  answers: HistoryAnswer[]
}

const STATE = { active: 'Pågår', finished: 'Klar', abandoned: 'Avbruten' }
const ASSESSED = { auto: '', self: 'Självbedömd', ai: 'AI-bedömd', pending: 'Väntar på självbedömning' }
const date = (s: string) => new Date(s).toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' })

function showAnswer(a: unknown, item?: Item): string {
  const choices = item && 'choices' in item ? item.choices : item && item.kind === 'ordering' ? item.items : []
  const text = (id: unknown) => choices.find((c) => c.id === id)?.text ?? String(id)
  if (typeof a === 'boolean') return a ? 'Sant' : 'Falskt'
  if (Array.isArray(a)) return a.map(text).join(', ')
  if (typeof a === 'string' && choices.length) return text(a)
  if (a && typeof a === 'object' && 'text' in a) return String((a as { text: string }).text)
  return { knew: 'Kunde', partly: 'Delvis', notYet: 'Inte än' }[String(a)] ?? String(a)
}

function result(a: HistoryAnswer): string {
  if (a.correct === null) return '–'
  if (a.correct) return 'Rätt'
  return a.score && a.score > 0 ? `Delvis (${Math.round(a.score * 100)} %)` : 'Inte rätt'
}

/** Adult view: past runs with every attempt. AI assessments are marked as advisory. */
export function RunHistory({ learnerId, variant, artifactId }: RunHistoryProps) {
  const [runs, setRuns] = useState<HistoryRun[]>()
  const [arts, setArts] = useState<Record<string, Artifact>>({})
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    const q = artifactId ? `?artifactId=${artifactId}` : ''
    api
      .get<HistoryRun[]>(`/learners/${learnerId}/runs${q}`)
      .then(async (list) => {
        if (!live) return
        setRuns(list)
        const ids = [...new Set(list.map((r) => r.artifactId))]
        const found = await Promise.all(
          ids.map((id) =>
            api
              .get<{ artifact: Artifact }>(`/artifacts/${id}`)
              .then((r) => r.artifact)
              .catch(() => undefined),
          ),
        )
        if (live) setArts(Object.fromEntries(found.filter((a) => a).map((a) => [a!.id, a!])))
      })
      .catch((e) => live && setError(errorText(variant, e, 'Historiken gick inte att hämta just nu.')))
    return () => {
      live = false
    }
  }, [learnerId, artifactId, variant])

  if (error) return <p className={styles.notice}>{error}</p>
  if (!runs) return <p className={styles.notice}>Hämtar historik …</p>
  if (!runs.length) return <p className={styles.notice}>Inga omgångar än.</p>

  return (
    <div className={styles.history} data-variant={variant}>
      {runs.map((r) => {
        const art = arts[r.artifactId]
        const item = (id: string) => art?.sections.flatMap((s) => s.items).find((i) => i.id === id)
        return (
          <details key={r.id} className={styles.historyRun}>
            <summary>
              <strong>{art?.title ?? 'Material'}</strong> · {date(r.startedAt)} · {STATE[r.state]}
              {r.summary && (
                <span className={styles.note}>
                  {' '}
                  · {r.summary.correct} av {r.summary.total}
                </span>
              )}
            </summary>
            <p className={styles.note}>
              Återkoppling: {r.feedback === 'immediate' ? 'direkt' : 'i slutet'} · version {r.artifactVersion}
            </p>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Uppgift</th>
                  <th scope="col">Försök</th>
                  <th scope="col">Svar</th>
                  <th scope="col">Resultat</th>
                </tr>
              </thead>
              <tbody>
                {r.answers.map((a) => (
                  <tr key={`${a.itemId}-${a.attempt}`}>
                    <td>{item(a.itemId)?.prompt ?? a.itemId}</td>
                    <td>{a.attempt}</td>
                    <td>{showAnswer(a.answer, item(a.itemId))}</td>
                    <td>
                      {result(a)}
                      {a.revealed && <span className={styles.note}> · visat svar</span>}
                      {ASSESSED[a.assessedBy] && (
                        <span className={a.assessedBy === 'ai' ? styles.badge : styles.note}>
                          {' '}
                          {ASSESSED[a.assessedBy]}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )
      })}
    </div>
  )
}
