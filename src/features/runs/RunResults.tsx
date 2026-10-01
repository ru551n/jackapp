import { useState } from 'react'
import type { RunSummary, RunView } from '../../../server/runs/api'
import { api } from '../../api/client'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { Markdown } from './Markdown'
import { errorText, RATINGS, type CommonProps } from './presentation'
import styles from './runs.module.css'

export interface RunResultsProps extends CommonProps {
  runId: string
  summary: RunSummary
  /** "Öva mer på det här": the skill tags that need more practice (the parent area wires this). */
  onPracticeMore?: (skills: string[]) => void
  /** "Klar – till start": a clear way out after the results. */
  onDone?: () => void
}

const skillLabel = (s: RunSummary['skills'][number]) =>
  'label' in s && typeof s.label === 'string' ? s.label : undefined

/** Non-punitive results: what went well, what to look at again. */
export function RunResults({ learnerId, variant, runId, summary: initial, onPracticeMore, onDone }: RunResultsProps) {
  const [summary, setSummary] = useState(initial)
  const [error, setError] = useState('')
  const detailed = variant === 'upper' || variant === 'adult'
  // The heading already says "Du klarade X av Y"; keep the rest of the server's line.
  const lead = summary.message.replace(/^Du klarade \d+ av \d+[.!]?\s*/, '')
  const practice = summary.skills.filter((s) => s.correct < s.total).map((s) => s.skill)

  const rate = async (itemId: string, answer: string, selfRating: string) => {
    try {
      const base = `/learners/${learnerId}/runs/${runId}`
      await api.post(`${base}/answers`, { itemId, answer: { text: answer, selfRating } })
      const run = await api.get<RunView>(base)
      if (run.summary) setSummary(run.summary)
    } catch (e) {
      setError(errorText(variant, e, 'Det gick inte att spara just nu. Prova igen.'))
    }
  }

  return (
    <section className={styles.results} data-variant={variant} aria-labelledby="results-heading">
      <div className={styles.resultsHead}>
        <Icon name="star" size={40} />
        <h2 id="results-heading" tabIndex={-1}>
          Du klarade {summary.correct} av {summary.total}
        </h2>
      </div>
      {lead && <p className={styles.lead}>{lead}</p>}

      {summary.skills.length > 0 && (
        <>
          <h3>Så gick det</h3>
          <ul className={styles.skills}>
            {summary.skills.map((s) => (
              <li key={s.skill}>
                <p>
                  {/* Skill tags are slugs; only a readable label (when the server sends one) is shown. */}
                  {skillLabel(s) && <strong>{skillLabel(s)}: </strong>}
                  {s.note}
                </p>
                {detailed && (
                  <p className={styles.note}>
                    {s.correct} av {s.total}
                    {variant === 'adult' && ` · ${s.skill}`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {summary.selfAssess.length > 0 && (
        <>
          <h3>Bedöm dina egna svar</h3>
          {summary.selfAssess.map((s) => (
            <article key={s.itemId} className={styles.reviewCard}>
              <p>
                Ditt svar: <em>{s.answer}</em>
              </p>
              <p>Ett bra svar tar upp:</p>
              <ul className={styles.rubric}>
                {s.rubric.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              {s.sampleAnswer && <p>Exempel på svar: {s.sampleAnswer}</p>}
              <div className={styles.ratings} role="group" aria-label="Hur bra stämmer ditt svar?">
                {RATINGS.map((r) => (
                  <Button key={r.v} variant="secondary" onClick={() => void rate(s.itemId, s.answer, r.v)}>
                    {r.label}
                  </Button>
                ))}
              </div>
            </article>
          ))}
        </>
      )}

      {summary.review.length > 0 && (
        <>
          <h3>Bra att titta på igen</h3>
          {summary.review.map((r) => (
            <article key={r.itemId} className={styles.reviewCard}>
              <p className={styles.fbTitle}>{r.prompt}</p>
              {r.solution && (
                <p>
                  Svaret: <strong>{r.solution}</strong>
                </p>
              )}
              {r.explanation && <Markdown text={r.explanation} />}
            </article>
          ))}
        </>
      )}

      {error && <p className={styles.note}>{error}</p>}
      {(onDone || onPracticeMore) && (
        <div className={styles.actions}>
          {onDone && (
            <Button icon="home" onClick={onDone}>
              Klar – till start
            </Button>
          )}
          {onPracticeMore && (
            <Button
              variant={onDone ? 'secondary' : 'primary'}
              icon="arrow"
              onClick={() => onPracticeMore(practice.length ? practice : summary.skills.map((s) => s.skill))}
            >
              Öva mer på det här
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
