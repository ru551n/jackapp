import { useState, type ReactNode } from 'react'
import type { ApprovalState, ItemKind, SourceMode } from '../../../shared/contracts'
import { api, ApiRequestError } from '../../api/client'
import { Button } from '../../ui/Button'
import { errorText, KIND_LABELS, type CommonProps } from '../runs/presentation'
import { JobProgress } from './JobProgress'
import styles from './study.module.css'

export interface TestConfiguratorProps extends CommonProps {
  studySetId: string
  /** The practice test exists. `approval` is 'pendingApproval' when an adult must look first. */
  onCreated: (artifactId: string, approval: ApprovalState) => void
  onCancel?: () => void
}

const COUNT_DEFAULT = { early: 6, middle: 10, upper: 12, adult: 10 }
const SOURCE_MODES: { v: SourceMode; label: string; help: string }[] = [
  {
    v: 'strict',
    label: 'Bara från materialet',
    help: 'Alla frågor bygger på det som står i det uppladdade materialet, och inget annat.',
  },
  {
    v: 'sourceAndCurriculum',
    label: 'Materialet + läroplanen',
    help: 'Materialet är grunden. Läroplanen används för att välja vad som är viktigt att öva på.',
  },
  {
    v: 'extended',
    label: 'Utgå från materialet och bredda',
    help: 'Materialet är startpunkten, men frågorna får gå lite utanför det för att bredda förståelsen.',
  },
]
const DIFFICULTY = ['Mycket lätt', 'Lätt', 'Lagom', 'Svår', 'Mycket svår']

function Choice({
  name,
  checked,
  onChange,
  children,
}: {
  name: string
  checked: boolean
  onChange: () => void
  children: ReactNode
}) {
  return (
    <label className={[styles.option, checked && styles.optionOn].filter(Boolean).join(' ')}>
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span>{children}</span>
    </label>
  )
}

export function TestConfigurator({ learnerId, variant, studySetId, onCreated, onCancel }: TestConfiguratorProps) {
  const [count, setCount] = useState(COUNT_DEFAULT[variant])
  const [difficulty, setDifficulty] = useState<number>() // undefined: fitted to the learner
  const [mix, setMix] = useState(true)
  const [kinds, setKinds] = useState<ItemKind[]>(['multipleChoice', 'trueFalse', 'fillBlank'])
  const [feedback, setFeedback] = useState<'immediate' | 'end'>('immediate')
  const [hints, setHints] = useState(true)
  const [sourceMode, setSourceMode] = useState<SourceMode>('strict')
  const [jobId, setJobId] = useState<string>()
  const [waiting, setWaiting] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    setError('')
    setJobId(undefined)
    try {
      const r = await api.post<{ jobId: string }>(`/learners/${learnerId}/generate`, {
        type: 'practiceTest',
        studySetId,
        sourceMode,
        questionCount: count,
        ...(difficulty ? { difficulty } : {}),
        ...(mix ? {} : { itemKinds: kinds }),
        feedback,
        hints,
      })
      setJobId(r.jobId)
    } catch (e) {
      // 403 requests_not_allowed carries its own calm Swedish line for learners too.
      setError(
        e instanceof ApiRequestError && e.code === 'requests_not_allowed'
          ? e.message
          : errorText(variant, e, 'Det gick inte att skapa uppgiften just nu.'),
      )
    }
  }

  const created = async (artifactId: string) => {
    // Learners get 404 for material that is not approved yet; that means it waits for an adult.
    const approval = await api
      .get<{ artifact: { approval: ApprovalState } }>(`/artifacts/${artifactId}?learnerId=${learnerId}`)
      .then((r) => r.artifact.approval)
      .catch(() => 'pendingApproval' as const)
    if (approval === 'pendingApproval') setWaiting(true)
    onCreated(artifactId, approval)
  }

  if (waiting)
    return (
      <section className={styles.panel} data-variant={variant}>
        <h2>Provet är nästan klart</h2>
        <p className={styles.okBox} role="status">
          {variant === 'adult'
            ? 'Provet väntar på ditt godkännande innan det kan göras.'
            : 'En vuxen tittar på provet först, så att allt blir rätt. Det dyker upp här när det är godkänt.'}
        </p>
      </section>
    )

  if (jobId)
    return (
      <section className={styles.panel} data-variant={variant}>
        <h2>Skapar övningsprov</h2>
        <JobProgress
          jobId={jobId}
          variant={variant}
          label="Provet förbereds"
          onCompleted={(j) => j.resultId && void created(j.resultId)}
          onRetry={() => void submit()}
        />
      </section>
    )

  return (
    <form
      className={styles.panel}
      data-variant={variant}
      aria-labelledby="config-heading"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <h2 id="config-heading">Gör ett övningsprov</h2>

      <fieldset className={styles.fieldset}>
        <legend>Var ska frågorna komma ifrån?</legend>
        {SOURCE_MODES.map((m) => (
          <Choice key={m.v} name="source" checked={sourceMode === m.v} onChange={() => setSourceMode(m.v)}>
            <strong>{m.label}</strong>
            <span className={styles.help}>{m.help}</span>
          </Choice>
        ))}
      </fieldset>

      <label className={styles.field}>
        <span>Antal frågor</span>
        <input
          type="number"
          min={1}
          max={60}
          value={count}
          onChange={(e) => setCount(Math.min(60, Math.max(1, Number(e.target.value) || 1)))}
        />
      </label>

      <fieldset className={styles.fieldset}>
        <legend>Svårighet</legend>
        <div className={styles.row}>
          <Choice name="difficulty" checked={difficulty === undefined} onChange={() => setDifficulty(undefined)}>
            Anpassad efter eleven
          </Choice>
          {DIFFICULTY.map((d, i) => (
            <Choice key={d} name="difficulty" checked={difficulty === i + 1} onChange={() => setDifficulty(i + 1)}>
              {d}
            </Choice>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend>Typ av frågor</legend>
        <Choice name="mix" checked={mix} onChange={() => setMix(true)}>
          Låt AI välja en bra blandning
        </Choice>
        <Choice name="mix" checked={!mix} onChange={() => setMix(false)}>
          Välj själv
        </Choice>
        {!mix && (
          <div className={styles.kinds}>
            {(Object.keys(KIND_LABELS) as ItemKind[]).map((k) => (
              <label key={k} className={styles.check}>
                <input
                  type="checkbox"
                  checked={kinds.includes(k)}
                  onChange={(e) => setKinds((ks) => (e.target.checked ? [...ks, k] : ks.filter((x) => x !== k)))}
                />
                {KIND_LABELS[k]}
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend>Återkoppling</legend>
        <div className={styles.row}>
          <Choice name="feedback" checked={feedback === 'immediate'} onChange={() => setFeedback('immediate')}>
            Direkt efter varje fråga
          </Choice>
          <Choice name="feedback" checked={feedback === 'end'} onChange={() => setFeedback('end')}>
            När provet är klart
          </Choice>
        </div>
      </fieldset>

      <label className={styles.check}>
        <input type="checkbox" checked={hints} onChange={(e) => setHints(e.target.checked)} />
        Ledtrådar när det behövs
      </label>

      {error && (
        <p className={styles.calmBox} role="status">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <Button type="submit" disabled={!mix && !kinds.length}>
          Skapa provet
        </Button>
        {onCancel && (
          <Button variant="quiet" onClick={onCancel}>
            Tillbaka
          </Button>
        )}
      </div>
    </form>
  )
}
