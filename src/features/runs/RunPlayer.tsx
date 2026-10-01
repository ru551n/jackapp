import { useEffect, useRef, useState } from 'react'
import type { MediaRef } from '../../../shared/contracts'
import type { AnswerFeedback, RunSummary, RunView } from '../../../server/runs/api'
import { api } from '../../api/client'
import { Button } from '../../ui/Button'
import { SpeakButton } from '../../ui/SpeakButton'
import { ItemInput } from './ItemInput'
import { Markdown } from './Markdown'
import { MediaList } from './Media'
import {
  errorText,
  initialValue,
  isAnswered,
  RATINGS,
  speechLang,
  type CommonProps,
  type PublicItem,
} from './presentation'
import { RunResults } from './RunResults'
import styles from './runs.module.css'

// Plays an approved artifact through the runs API (docs/platform/runs.md). No timers, ever.

export interface RunPlayerProps extends CommonProps {
  artifactId: string
  /** Called once the run is finished (the results are shown here as well). */
  onFinished?: (summary: RunSummary) => void
  /** "Öva mer på det här": skill tags worth more practice. */
  onPracticeMore?: (skills: string[]) => void
  /** Leave without finishing; the run stays active and resumes next time. */
  onExit?: () => void
}

interface SectionLike {
  title?: string
  body?: string
  media?: MediaRef[]
  items?: { id: string }[]
}
type Step = { kind: 'section'; section: SectionLike } | { kind: 'item'; item: PublicItem }

interface ItemState {
  value: unknown
  attempts: number
  hints: string[]
  hintsShown: number
  feedback?: AnswerFeedback
  done: boolean
  /** Last submitted answer, so a repeated tap is not a new try. */
  sent?: string
}

const TAP_KINDS = new Set(['multipleChoice', 'trueFalse'])

function buildSteps(items: PublicItem[], sections?: SectionLike[]): Step[] {
  const byId = new Map(items.map((i) => [i.id, i]))
  const steps: Step[] = []
  for (const s of sections ?? []) {
    if (s.body?.trim() || s.media?.length) steps.push({ kind: 'section', section: s })
    for (const { id } of s.items ?? []) {
      const it = byId.get(id)
      if (it) steps.push({ kind: 'item', item: it })
      byId.delete(id)
    }
  }
  for (const it of byId.values()) steps.push({ kind: 'item', item: it })
  return steps
}

export function RunPlayer({
  learnerId,
  variant,
  presentation = {},
  artifactId,
  onFinished,
  onPracticeMore,
  onExit,
}: RunPlayerProps) {
  const [run, setRun] = useState<RunView>()
  const [steps, setSteps] = useState<Step[]>([])
  const [index, setIndex] = useState(0)
  const [states, setStates] = useState<Record<string, ItemState>>({})
  const [summary, setSummary] = useState<RunSummary | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  /** End mode: quiet "saved" line carried to the next item. */
  const [saved, setSaved] = useState('')
  const headingRef = useRef<HTMLHeadingElement>(null)
  const base = `/learners/${learnerId}/runs`

  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const r = await api.post<RunView>(base, { artifactId })
        const art = await api
          .get<{ artifact: { sections: SectionLike[] } }>(`/artifacts/${artifactId}`)
          .catch(() => undefined)
        if (!live) return
        const items = r.items as unknown as PublicItem[]
        const all = buildSteps(items, art?.artifact.sections)
        const st: Record<string, ItemState> = {}
        for (const it of items) {
          const p = r.progress[it.id]
          st[it.id] = {
            value: p?.answer ?? initialValue(it),
            attempts: p?.attempts ?? 0,
            hints: [],
            hintsShown: p?.hintsShown ?? 0,
            feedback: p?.feedback,
            done: p?.done ?? false,
          }
        }
        const started = items.some((it) => st[it.id]!.attempts > 0)
        const open = all.findIndex(
          (s) => s.kind === 'item' && !(r.feedback === 'end' ? st[s.item.id]!.attempts : st[s.item.id]!.done),
        )
        setRun(r)
        setSteps(all)
        setStates(st)
        setSummary(r.summary)
        setIndex(started && open > 0 ? open : 0)
      } catch (e) {
        if (live)
          setError(errorText(variant, e, 'Det gick inte att öppna uppgifterna just nu. Prova igen om en stund.'))
      }
    })()
    return () => {
      live = false
    }
  }, [base, artifactId, variant])

  // Each step starts with focus on its heading (no scrolling jumps).
  useEffect(() => headingRef.current?.focus({ preventScroll: true }), [index, run])

  if (summary && run)
    return (
      <RunResults
        learnerId={learnerId}
        variant={variant}
        presentation={presentation}
        runId={run.id}
        summary={summary}
        onPracticeMore={onPracticeMore}
      />
    )
  if (error && !run)
    return (
      <p className={styles.notice} role="status">
        {error}
      </p>
    )
  if (!run || !steps.length)
    return (
      <p className={styles.notice} role="status">
        Hämtar uppgifterna …
      </p>
    )

  const end = run.feedback === 'end'
  const step = steps[index]!
  const itemSteps = steps.filter((s) => s.kind === 'item')
  const last = index === steps.length - 1
  const patch = (id: string, p: Partial<ItemState>) => setStates((s) => ({ ...s, [id]: { ...s[id]!, ...p } }))

  const finish = async () => {
    setBusy(true)
    try {
      const s = await api.post<RunSummary>(`${base}/${run.id}/finish`)
      setSummary(s)
      onFinished?.(s)
    } catch (e) {
      setError(errorText(variant, e, 'Det gick inte att lämna in just nu. Prova igen.'))
    } finally {
      setBusy(false)
    }
  }
  const go = (d: 1 | -1) => {
    setSaved('')
    setIndex((i) => i + d)
  }
  const next = () => (last ? void finish() : go(1))

  const submit = async (item: PublicItem, answer: unknown, selfRating?: string) => {
    const st = states[item.id]!
    const key = JSON.stringify(answer)
    if (!selfRating && st.sent === key && !end) return // same answer again is not a new try
    setBusy(true)
    setError('')
    try {
      const fb = await api.post<AnswerFeedback>(`${base}/${run.id}/answers`, {
        itemId: item.id,
        attempt: selfRating ? st.attempts : st.attempts + 1,
        answer: selfRating ? { ...(answer as object), selfRating } : answer,
      })
      patch(item.id, {
        value: answer,
        sent: key,
        attempts: fb.attempt,
        feedback: fb,
        done: fb.done,
        hints: fb.hint ? [...st.hints, fb.hint] : st.hints,
        hintsShown: fb.hint ? st.hintsShown + 1 : st.hintsShown,
      })
      // End mode: saved quietly, move on.
      if (end && !fb.selfAssess && !last) {
        setIndex((i) => i + 1)
        setSaved('Förra svaret är sparat.')
      }
    } catch (e) {
      setError(errorText(variant, e, 'Det gick inte att spara svaret just nu. Prova igen.'))
    } finally {
      setBusy(false)
    }
  }

  const askHint = async (item: PublicItem) => {
    setBusy(true)
    try {
      const h = await api.post<{ hint: string | null; hintsShown: number }>(`${base}/${run.id}/hint`, {
        itemId: item.id,
      })
      const st = states[item.id]!
      patch(item.id, { hints: h.hint ? [...st.hints, h.hint] : st.hints, hintsShown: h.hintsShown })
    } catch (e) {
      setError(errorText(variant, e, 'Ledtråden gick inte att hämta just nu.'))
    } finally {
      setBusy(false)
    }
  }

  const rootClass = [styles.player, presentation.reducedMotion && styles.still].filter(Boolean).join(' ')
  const readAloud = presentation.readAloud !== false

  if (step.kind === 'section')
    return (
      <section className={rootClass} data-variant={variant} aria-labelledby="run-heading">
        <p className={styles.runTitle}>{run.title}</p>
        <h2 id="run-heading" ref={headingRef} tabIndex={-1} className={styles.prompt}>
          {step.section.title ?? 'Läs först'}
        </h2>
        {step.section.body && (
          <div className={styles.sectionBody}>
            <Markdown text={step.section.body} />
            {readAloud && <SpeakButton text={step.section.body.replace(/[*#]/g, '')} label="Lyssna" />}
          </div>
        )}
        <MediaList media={step.section.media} large={presentation.visualSupport === 'high'} />
        <div className={styles.actions}>
          <Button icon="arrow" onClick={next}>
            Fortsätt
          </Button>
        </div>
      </section>
    )

  const item = step.item
  const st = states[item.id]!
  const fb = st.feedback
  const n = itemSteps.indexOf(step) + 1
  const tap = variant === 'early' && TAP_KINDS.has(item.kind)
  const lang = speechLang(item.lang)
  const selfAssess = fb && !fb.done && fb.selfAssess
  const waitingRetry = !end && fb && !fb.done && !fb.selfAssess
  const hintsLeft = (item.hintCount ?? 0) > st.hintsShown && !st.done
  const showAnswerButton = !st.done && !selfAssess && !tap && item.kind !== 'flashcard'
  const collapse = presentation.textAmount === 'minimal'

  return (
    <section className={rootClass} data-variant={variant} aria-labelledby="run-heading">
      <div className={styles.progressRow}>
        <span>
          {run.title} · Uppgift {n} av {itemSteps.length}
        </span>
        <progress max={itemSteps.length} value={n} aria-label={`Uppgift ${n} av ${itemSteps.length}`} />
      </div>

      <div className={styles.promptRow}>
        <h2
          id="run-heading"
          ref={headingRef}
          tabIndex={-1}
          className={styles.prompt}
          lang={item.lang && item.lang !== 'sv' ? item.lang : undefined}
        >
          {item.kind === 'flashcard' ? 'Vänd kortet och känn efter' : item.prompt}
        </h2>
        {readAloud && lang && <SpeakButton text={item.prompt} lang={lang} />}
      </div>

      <MediaList media={item.media} large={presentation.visualSupport === 'high'} />

      <ItemInput
        key={item.id}
        item={item}
        value={st.value}
        disabled={busy || st.done || !!selfAssess}
        tapToAnswer={tap}
        columns={presentation.maxChoices}
        onChange={(v, now) => {
          patch(item.id, { value: v })
          if (now) void submit(item, v)
        }}
      />

      <div className={styles.feedback}>
        <p className="visually-hidden" role="status">
          {fb ? [fb.message, ...(waitingRetry ? st.hints.slice(-1) : [])].join(' ') : saved}
        </p>
        {fb?.done && (
          <div className={fb.correct ? styles.success : styles.reveal}>
            <p className={styles.fbTitle}>{fb.message}</p>
            {fb.solution && !fb.correct && (
              <p>
                Svaret: <strong>{fb.solution}</strong>
              </p>
            )}
            {fb.ai && <p>{fb.ai.feedback}</p>}
            {fb.explanation &&
              (collapse ? (
                <details>
                  <summary>Visa förklaring</summary>
                  <Markdown text={fb.explanation} />
                </details>
              ) : (
                <Markdown text={fb.explanation} />
              ))}
          </div>
        )}
        {waitingRetry && (
          <div className={styles.hint}>
            <p className={styles.tryAgain}>{fb.message}</p>
            {st.hints.length > 0 && <p>{st.hints.at(-1)}</p>}
          </div>
        )}
        {!fb && st.hints.length > 0 && (
          <div className={styles.hint}>
            <p className={styles.tryAgain}>Ledtråd</p>
            <p>{st.hints.at(-1)}</p>
          </div>
        )}
        {selfAssess && (
          <div className={styles.reveal}>
            <p className={styles.fbTitle}>{fb.message}</p>
            <ul className={styles.rubric}>
              {selfAssess.rubric.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            {selfAssess.sampleAnswer && (
              <p>
                Exempel på svar: <em>{selfAssess.sampleAnswer}</em>
              </p>
            )}
            <div className={styles.ratings} role="group" aria-label="Hur bra stämmer ditt svar?">
              {RATINGS.map((r) => (
                <Button key={r.v} variant="secondary" disabled={busy} onClick={() => void submit(item, st.value, r.v)}>
                  {r.label}
                </Button>
              ))}
            </div>
          </div>
        )}
        {end && (fb?.message ?? saved) && <p className={styles.note}>{fb?.message ?? saved}</p>}
        {error && <p className={styles.note}>{error}</p>}
      </div>

      <div className={styles.actions}>
        {showAnswerButton && (
          <Button disabled={busy || !isAnswered(item, st.value)} onClick={() => void submit(item, st.value)}>
            {end ? (fb ? 'Spara nytt svar' : 'Spara svar') : 'Svara'}
          </Button>
        )}
        {hintsLeft && (
          <Button variant="secondary" disabled={busy} onClick={() => void askHint(item)}>
            Ledtråd
          </Button>
        )}
        {(st.done || end || fb) && (
          <Button icon="arrow" disabled={busy} onClick={next}>
            {last ? (end ? 'Lämna in' : 'Se resultat') : 'Nästa'}
          </Button>
        )}
        {!st.done && !end && !fb && (
          <Button variant="quiet" disabled={busy} onClick={next}>
            {last ? 'Avsluta' : 'Hoppa över'}
          </Button>
        )}
        {end && index > 0 && (
          <Button variant="quiet" disabled={busy} onClick={() => go(-1)}>
            Föregående
          </Button>
        )}
        {onExit && (
          <Button variant="quiet" onClick={onExit}>
            Pausa
          </Button>
        )}
      </div>
    </section>
  )
}
