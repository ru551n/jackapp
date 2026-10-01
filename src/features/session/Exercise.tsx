import { useEffect, useRef, useState } from 'react'
import type { Choice, Hint, Question } from '../../core/types'
import { playSoftChime } from '../../lib/sound'
import { getState } from '../../store/store'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { SceneView } from '../../ui/SceneView'
import { SpeakButton } from '../../ui/SpeakButton'
import styles from './Exercise.module.css'

/** After this many misses the correct answer is gently shown. */
export const REVEAL_AFTER = 3

interface Props {
  question: Question
  /** Called once when the child has answered correctly and pressed "Nästa". */
  onDone: (misses: number, hintsShown: number) => void
  nextLabel: string
}

export function Exercise({ question, onDone, nextLabel }: Props) {
  const [misses, setMisses] = useState(0)
  const [tried, setTried] = useState<string[]>([])
  const [placed, setPlaced] = useState<string[]>([]) // order tasks
  const [solved, setSolved] = useState(false)
  const nextRef = useRef<HTMLButtonElement>(null)

  const hintsShown = Math.min(misses, question.hints.length)
  const hint: Hint | undefined = misses > 0 ? question.hints[hintsShown - 1] : undefined
  const eliminated = new Set(question.hints.slice(0, hintsShown).flatMap((h) => h.eliminate ?? []))
  const reveal = misses >= REVEAL_AFTER && !solved
  const scene = [...question.hints.slice(0, hintsShown)].reverse().find((h) => h.scene)?.scene ?? question.scene

  useEffect(() => {
    if (solved) nextRef.current?.focus()
  }, [solved])

  const succeed = () => {
    setSolved(true)
    if (getState().settings.sound) playSoftChime()
  }
  const miss = (id: string) => {
    setMisses((m) => m + 1)
    setTried((t) => [...t, id])
  }

  const answerChoice = (id: string) => {
    if (solved || question.task.kind !== 'choice') return
    if (id === question.task.answer) succeed()
    else miss(id)
  }

  const answerOrder = (id: string) => {
    if (solved || question.task.kind !== 'order') return
    const expected = question.task.answer[placed.length]
    if (id !== expected) return miss(id)
    const next = [...placed, id]
    setPlaced(next)
    setTried([])
    if (next.length === question.task.answer.length) succeed()
  }

  const expectedNext = question.task.kind === 'choice' ? question.task.answer : question.task.answer[placed.length]

  return (
    <section className={styles.exercise} aria-labelledby="prompt">
      <div className={styles.promptRow}>
        <h2 id="prompt" className={styles.prompt}>
          {question.prompt}
        </h2>
        <div className={styles.speakers}>
          <SpeakButton text={question.speech ?? question.prompt} />
          {question.listen && (
            <SpeakButton
              text={question.listen.text}
              lang={question.listen.lang}
              label={question.listen.lang === 'en' ? 'Hör på engelska' : 'Hör ordet'}
            />
          )}
        </div>
      </div>

      {scene && (
        <div className={styles.scene}>
          <SceneView scene={scene} />
        </div>
      )}

      {question.task.kind === 'order' && (
        <ol className={styles.track} aria-label="Din ordning">
          {question.task.answer.map((_, i) => {
            const item =
              question.task.kind === 'order' ? question.task.items.find((c) => c.id === placed[i]) : undefined
            return (
              <li key={i} className={styles.slot}>
                {item ? <ChoiceContent choice={item} /> : <span className={styles.slotNumber}>{i + 1}</span>}
              </li>
            )
          })}
        </ol>
      )}

      <div
        className={styles.choices}
        data-count={question.task.kind === 'choice' ? question.task.choices.length : question.task.items.length}
      >
        {(question.task.kind === 'choice' ? question.task.choices : question.task.items).map((c) => {
          const isPlaced = placed.includes(c.id)
          const isCorrect = solved && question.task.kind === 'choice' && c.id === question.task.answer
          const dimmed = !solved && (eliminated.has(c.id) || tried.includes(c.id))
          return (
            <button
              key={c.id}
              type="button"
              className={[
                styles.choice,
                dimmed && styles.dimmed,
                isPlaced && styles.placed,
                isCorrect && styles.correct,
                reveal && c.id === expectedNext && styles.reveal,
              ]
                .filter(Boolean)
                .join(' ')}
              aria-label={c.ariaLabel}
              aria-disabled={dimmed || isPlaced || solved || undefined}
              onClick={() => {
                if (dimmed || isPlaced) return
                if (question.task.kind === 'choice') answerChoice(c.id)
                else answerOrder(c.id)
              }}
            >
              <ChoiceContent choice={c} />
            </button>
          )
        })}
      </div>

      <div className={styles.feedback} role="status" aria-live="polite">
        {solved ? (
          <div className={styles.success}>
            <Icon name="check" size={36} />
            <p>{question.success ?? 'Bra!'}</p>
            <Button ref={nextRef} icon="arrow" onClick={() => onDone(misses, hintsShown)}>
              {nextLabel}
            </Button>
          </div>
        ) : hint ? (
          <div className={styles.hint}>
            <p className={styles.tryAgain}>Prova igen</p>
            <p>{reveal ? 'Titta, den här är rätt. Tryck på den.' : hint.text}</p>
            {!reveal && <SpeakButton text={`Prova igen. ${hint.text}`} />}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function ChoiceContent({ choice }: { choice: Choice }) {
  return (
    <>
      {choice.visual && <SceneView scene={choice.visual} compact />}
      {choice.label && <span className={styles.label}>{choice.label}</span>}
    </>
  )
}
