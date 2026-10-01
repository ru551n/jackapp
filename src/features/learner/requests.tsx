import { useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { usePaths } from '../../app/paths'
import { ApiRequestError } from '../../api/client'
import { useJob } from '../../api/useJob'
import { Sprite } from '../../art/sprites'
import type { SpriteId } from '../../core/types'
import { Button, LinkButton } from '../../ui/Button'
import { SpeakButton } from '../../ui/SpeakButton'
import { CALM_FAILURE, learnerApi, type LearnerRequest } from './api'
import { useLearner } from './context'
import { Frame } from './Frame'
import styles from './learner.module.css'

// Learner requests: guided picture choices (early, and an alternative in middle), free text with
// suggestion chips (middle, upper), then a calm wait for the job and the result.

export interface Option {
  id: string
  label: string
  sprite?: SpriteId
}

type Kind = 'artifact' | 'path'
export type Submit = (call: () => Promise<{ jobId: string }>, kind?: Kind) => void

/** Runs a create call and shows its progress; `children` renders the form while idle. */
export function Creator({
  children,
  onComplete,
}: {
  children: (submit: Submit) => ReactNode
  onComplete?: () => void
}) {
  const [state, setState] = useState<{ jobId: string; kind: Kind } | 'failed' | 'sending'>()
  const submit: Submit = (call, kind = 'artifact') => {
    setState('sending')
    call().then(
      (r) => setState({ jobId: r.jobId, kind }),
      () => setState('failed'),
    )
  }
  const again = () => setState(undefined)
  if (state === 'failed') return <Calm onAgain={again} />
  if (state === 'sending') return <Working />
  if (state)
    return <JobWait key={state.jobId} jobId={state.jobId} kind={state.kind} onAgain={again} onComplete={onComplete} />
  return <>{children(submit)}</>
}

function Calm({ onAgain }: { onAgain: () => void }) {
  const paths = usePaths()
  return (
    <section className={styles.panel} role="status">
      <p className={styles.lead}>{CALM_FAILURE}</p>
      <div className={styles.row}>
        <Button onClick={onAgain}>Prova igen</Button>
        <LinkButton to={paths.home} variant="secondary" icon="home">
          Hem
        </LinkButton>
      </div>
    </section>
  )
}

function Working({ progress, step }: { progress?: number; step?: string }) {
  const { flags } = useLearner()
  return (
    <section className={styles.panel} role="status" aria-live="polite">
      <p className={styles.lead}>{flags.band === 'upper' ? 'Skapar materialet …' : 'Vi gör ditt uppdrag …'}</p>
      <progress className={styles.progress} value={progress ?? 0} max={1} aria-label="Hur långt det har kommit" />
      {flags.band !== 'early' && step && <p className={styles.muted}>{step}</p>}
    </section>
  )
}

/** Follows the job; a finished artifact is either ready to start or waits for an adult. */
export function JobWait({
  jobId,
  kind,
  onAgain,
  onComplete,
}: {
  jobId: string
  kind: Kind
  onAgain: () => void
  onComplete?: () => void
}) {
  const paths = usePaths()
  const status = useJob(jobId)
  const completed = status?.state === 'completed'
  const resultId = completed ? status.resultId : undefined
  useEffect(() => {
    if (completed) onComplete?.()
    // Once per job.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [completed])
  const [result, setResult] = useState<'ready' | 'pending' | 'failed'>()
  useEffect(() => {
    if (!resultId || kind !== 'artifact') return
    learnerApi.artifact(resultId).then(
      () => setResult('ready'),
      (e: unknown) => setResult(e instanceof ApiRequestError && e.status === 404 ? 'pending' : 'failed'),
    )
  }, [resultId, kind])

  if (status?.state === 'failed' || status?.state === 'cancelled' || result === 'failed')
    return <Calm onAgain={onAgain} />
  if (status?.state === 'completed' && (kind === 'path' || result)) {
    const text =
      kind === 'path'
        ? 'Din plan är klar.'
        : result === 'ready'
          ? 'Ditt uppdrag är klart!'
          : 'En vuxen tittar på uppdraget först.'
    return (
      <section className={styles.panel} role="status">
        <p className={styles.lead}>{text}</p>
        <div className={styles.row}>
          {result === 'ready' && resultId && (
            <LinkButton to={paths.material(resultId)} icon="arrow">
              Starta
            </LinkButton>
          )}
          <LinkButton to={paths.home} variant="secondary" icon="home">
            Hem
          </LinkButton>
        </div>
      </section>
    )
  }
  return <Working progress={status?.progress} step={status?.step} />
}

/** Shows at most `max` options at a time; "Fler val" pages through the rest. */
function Choices({ items, max, onPick }: { items: Option[]; max: number; onPick: (p: Option) => void }) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(items.length / max))
  const shown = items.slice(page * max, page * max + max)
  return (
    <>
      <ul className={styles.choices}>
        {shown.map((p) => (
          <li key={p.id}>
            <button type="button" className={styles.choice} onClick={() => onPick(p)}>
              {p.sprite && <Sprite id={p.sprite} className={styles.choiceArt} />}
              <span>{p.label}</span>
            </button>
          </li>
        ))}
      </ul>
      {pages > 1 && (
        <Button variant="quiet" onClick={() => setPage((page + 1) % pages)}>
          Fler val
        </Button>
      )}
    </>
  )
}

/** "Vad vill du öva på?" → "Vilket tema?" → confirm. No free text. */
export function GuidedRequest({
  subjects,
  themes,
  onSubmit,
}: {
  subjects: Option[]
  themes: Option[]
  onSubmit: (req: LearnerRequest) => void
}) {
  const { flags } = useLearner()
  const [subject, setSubject] = useState<Option>()
  const [theme, setTheme] = useState<Option>()
  const step = !subject ? 'subject' : !theme ? 'theme' : 'confirm'
  const question =
    step === 'subject' ? 'Vad vill du öva på?' : step === 'theme' ? 'Vilket tema?' : 'Ska vi göra det här uppdraget?'
  const summary = subject && theme ? `${subject.label}${theme.id ? ` med ${theme.label.toLowerCase()}` : ''}` : ''
  return (
    <section className={styles.guided} aria-labelledby="guided-q">
      <div className={styles.row}>
        <h2 id="guided-q" className={styles.question}>
          {question}
        </h2>
        <SpeakButton text={step === 'confirm' ? `${question} ${summary}` : question} />
      </div>
      {step === 'subject' && <Choices items={subjects} max={flags.maxChoices} onPick={setSubject} />}
      {step === 'theme' && <Choices items={themes} max={flags.maxChoices} onPick={setTheme} />}
      {step === 'confirm' && (
        <>
          <p className={styles.lead}>{summary}</p>
          <div className={styles.row}>
            <Button
              icon="arrow"
              onClick={() =>
                onSubmit({
                  type: 'exercises',
                  subjectCode: subject!.id,
                  ...(theme!.id ? { theme: theme!.label } : {}),
                })
              }
            >
              Skapa uppdrag
            </Button>
            <Button variant="secondary" icon="back" onClick={() => setTheme(undefined)}>
              Tillbaka
            </Button>
          </div>
        </>
      )}
      {step === 'theme' && (
        <Button variant="quiet" icon="back" onClick={() => setSubject(undefined)}>
          Tillbaka
        </Button>
      )}
    </section>
  )
}

/** Free text with suggestion chips; the theme is optional. */
export function FreeRequest({
  chips,
  themes = [],
  initial = '',
  onSubmit,
}: {
  chips: string[]
  themes?: string[]
  initial?: string
  onSubmit: (req: LearnerRequest) => void
}) {
  const [text, setText] = useState(initial)
  const [theme, setTheme] = useState<string>()
  const go = () => onSubmit({ instructions: text.trim(), ...(theme ? { theme } : {}) })
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault()
        if (text.trim()) go()
      }}
    >
      <label htmlFor="req-text" className={styles.label}>
        Vad vill du lära dig?
      </label>
      <textarea
        id="req-text"
        className={styles.textarea}
        rows={3}
        maxLength={500}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className={styles.chips} role="group" aria-label="Förslag">
        {chips.map((c) => (
          <button key={c} type="button" className={styles.chip} onClick={() => setText(c)}>
            {c}
          </button>
        ))}
      </div>
      {themes.length > 0 && (
        <div className={styles.chips} role="group" aria-label="Tema (valfritt)">
          <span className={styles.muted}>Tema (valfritt):</span>
          {themes.map((t) => (
            <button
              key={t}
              type="button"
              className={styles.chip}
              aria-pressed={theme === t}
              onClick={() => setTheme(theme === t ? undefined : t)}
            >
              {t}
            </button>
          ))}
        </div>
      )}
      <div className={styles.row}>
        <Button type="submit" icon="arrow" disabled={!text.trim()}>
          Skapa
        </Button>
      </div>
    </form>
  )
}

/** "Önska uppdrag": the band decides guided or free; disabled profiles get a calm pointer to an adult. */
export function RequestPage({
  guided,
  chips,
  themes,
}: {
  guided?: { subjects: Option[]; themes: Option[] }
  chips?: string[]
  themes?: string[]
}) {
  const { learner, flags } = useLearner()
  const initial = (useLocation().state as { text?: string } | null)?.text
  const [mode, setMode] = useState<'guided' | 'free'>(chips && !flags.stepByStep ? 'free' : 'guided')
  const title = flags.band === 'upper' ? 'Ny förfrågan' : 'Önska ett uppdrag'
  if (!learner.learnerRequestsAllowed) {
    return (
      <Frame title={title}>
        <p className={styles.lead}>Be en vuxen om ett nytt uppdrag.</p>
      </Frame>
    )
  }
  return (
    <Frame title={title}>
      <Creator>
        {(submit) => {
          const send = (req: LearnerRequest) => submit(() => learnerApi.generate(learner.id, req))
          return mode === 'guided' && guided ? (
            <>
              <GuidedRequest subjects={guided.subjects} themes={guided.themes} onSubmit={send} />
              {chips && (
                <Button variant="quiet" onClick={() => setMode('free')}>
                  Skriv själv i stället
                </Button>
              )}
            </>
          ) : (
            <>
              <FreeRequest chips={chips ?? []} themes={themes} initial={initial} onSubmit={send} />
              {guided && (
                <Button variant="quiet" onClick={() => setMode('guided')}>
                  Välj steg för steg i stället
                </Button>
              )}
            </>
          )
        }}
      </Creator>
    </Frame>
  )
}
