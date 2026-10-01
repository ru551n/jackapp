import { Fragment, useState, type CSSProperties } from 'react'
import { MediaImage } from './Media'
import { blankCount, RATINGS, type PublicChoice, type PublicItem } from './presentation'
import styles from './runs.module.css'

// Answer editors for every item kind. Values follow AnswerByKind (server/runs/api.ts).

export interface ItemInputProps {
  item: PublicItem
  value: unknown
  /** `submit` asks the player to send the answer at once (tile taps in the early band, flashcards). */
  onChange: (value: unknown, submit?: boolean) => void
  disabled?: boolean
  /** Tap a tile to answer directly (early band). */
  tapToAnswer?: boolean
  /** Tiles per row (support preference maxChoices). */
  columns?: number
}

const cols = (n: number, max?: number) => ({ '--cols': Math.min(n, max ?? n, 4) }) as CSSProperties

export function ItemInput(props: ItemInputProps) {
  const { item } = props
  switch (item.kind) {
    case 'multipleChoice':
    case 'multiSelect':
    case 'trueFalse':
      return <Choices {...props} />
    case 'fillBlank':
      return <FillBlank {...props} />
    case 'matching':
      return <Matching {...props} />
    case 'ordering':
      return <Ordering {...props} />
    case 'numeric':
      return <Numeric {...props} />
    case 'freeText':
      return <FreeText {...props} />
    case 'flashcard':
      return <Flashcard {...props} />
  }
}

function Choices({ item, value, onChange, disabled, tapToAnswer, columns }: ItemInputProps) {
  const multi = item.kind === 'multiSelect'
  const options: { key: string; v: string | boolean; choice?: PublicChoice; label: string }[] =
    item.kind === 'trueFalse'
      ? [
          { key: 'true', v: true, label: 'Sant' },
          { key: 'false', v: false, label: 'Falskt' },
        ]
      : (item.choices ?? []).map((c) => ({ key: c.id, v: c.id, choice: c, label: c.text }))
  const picked = (v: string | boolean) => (multi ? ((value as string[]) ?? []).includes(v as string) : value === v)
  const pick = (v: string | boolean) => {
    if (disabled) return
    if (!multi) return onChange(v, tapToAnswer)
    const cur = (value as string[]) ?? []
    onChange(cur.includes(v as string) ? cur.filter((x) => x !== v) : [...cur, v as string])
  }
  return (
    <div
      className={styles.tiles}
      style={cols(options.length, columns)}
      role="group"
      aria-label={multi ? 'Välj ett eller flera svar' : 'Välj ett svar'}
    >
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          className={[styles.tile, picked(o.v) && styles.picked].filter(Boolean).join(' ')}
          aria-pressed={picked(o.v)}
          aria-disabled={disabled || undefined}
          onClick={() => pick(o.v)}
          lang={item.lang && item.lang !== 'sv' ? item.lang : undefined}
        >
          {multi && (
            <span className={styles.check} aria-hidden="true">
              {picked(o.v) ? '✓' : ''}
            </span>
          )}
          {o.choice?.media && <MediaImage media={o.choice.media} />}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  )
}

function FillBlank({ item, value, onChange, disabled }: ItemInputProps) {
  const n = blankCount(item)
  const vals = (value as string[] | undefined) ?? []
  const parts = (item.text ?? '').split('___')
  const set = (i: number, s: string) => onChange(Array.from({ length: n }, (_, j) => (j === i ? s : (vals[j] ?? ''))))
  const input = (i: number) => (
    <input
      key={`b${i}`}
      className={styles.blank}
      aria-label={`Lucka ${i + 1} av ${n}`}
      value={vals[i] ?? ''}
      disabled={disabled}
      autoComplete="off"
      spellCheck={false}
      onChange={(e) => set(i, e.target.value)}
      size={Math.max(6, (vals[i] ?? '').length + 2)}
    />
  )
  return (
    <p className={styles.fillText} lang={item.lang && item.lang !== 'sv' ? item.lang : undefined}>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {p}
          {i < n && i < parts.length - 1 && input(i)}
        </Fragment>
      ))}
      {/* Text without enough markers: remaining blanks follow the text. */}
      {Array.from({ length: Math.max(0, n - (parts.length - 1)) }, (_, k) => input(parts.length - 1 + k))}
    </p>
  )
}

function Matching({ item, value, onChange, disabled }: ItemInputProps) {
  const left = item.left ?? []
  const right = item.right ?? []
  const vals = (value as string[] | undefined) ?? left.map(() => '')
  return (
    <ul className={styles.pairs}>
      {left.map((l, i) => (
        <li key={i} className={styles.pair}>
          <label htmlFor={`${item.id}-m${i}`}>{l}</label>
          <select
            id={`${item.id}-m${i}`}
            value={vals[i] ?? ''}
            disabled={disabled}
            onChange={(e) => onChange(left.map((_, j) => (j === i ? e.target.value : (vals[j] ?? ''))))}
          >
            <option value="">Välj …</option>
            {right.map((r) => (
              <option key={r} value={r}>
                {r}
                {vals.includes(r) && vals[i] !== r ? ' (vald)' : ''}
              </option>
            ))}
          </select>
        </li>
      ))}
    </ul>
  )
}

function Ordering({ item, value, onChange, disabled }: ItemInputProps) {
  const byId = new Map((item.items ?? []).map((c) => [c.id, c]))
  const order = (value as string[] | undefined) ?? [...byId.keys()]
  const [said, setSaid] = useState('')
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (disabled || j < 0 || j >= order.length) return
    const next = [...order]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    onChange(next)
    setSaid(`${byId.get(order[i]!)?.text} är nu på plats ${j + 1} av ${order.length}.`)
  }
  return (
    <>
      <ol className={styles.order} aria-label="Din ordning">
        {order.map((id, i) => {
          const c = byId.get(id)
          return (
            <li key={id} className={styles.orderRow}>
              <span className={styles.orderNo} aria-hidden="true">
                {i + 1}
              </span>
              <span className={styles.orderText}>
                {c?.media && <MediaImage media={c.media} />}
                {c?.text}
              </span>
              <button
                type="button"
                className={styles.move}
                aria-label={`Flytta upp ${c?.text}`}
                disabled={disabled || i === 0}
                onClick={() => move(i, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className={styles.move}
                aria-label={`Flytta ner ${c?.text}`}
                disabled={disabled || i === order.length - 1}
                onClick={() => move(i, 1)}
              >
                ↓
              </button>
            </li>
          )
        })}
      </ol>
      <p className="visually-hidden" aria-live="polite">
        {said}
      </p>
    </>
  )
}

function Numeric({ item, value, onChange, disabled }: ItemInputProps) {
  return (
    <div className={styles.numeric}>
      <label htmlFor={`${item.id}-num`} className="visually-hidden">
        Ditt svar{item.unit ? ` i ${item.unit}` : ''}
      </label>
      <input
        id={`${item.id}-num`}
        inputMode="decimal"
        autoComplete="off"
        value={(value as string | undefined) ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {item.unit && <span aria-hidden="true">{item.unit}</span>}
      <p className={styles.note}>Du kan skriva decimaler med komma, till exempel 3,5.</p>
    </div>
  )
}

function FreeText({ item, value, onChange, disabled }: ItemInputProps) {
  const text = (value as { text?: string } | undefined)?.text ?? ''
  return (
    <>
      <label htmlFor={`${item.id}-text`} className="visually-hidden">
        Ditt svar
      </label>
      <textarea
        id={`${item.id}-text`}
        className={styles.textarea}
        rows={6}
        maxLength={4000}
        value={text}
        disabled={disabled}
        lang={item.lang && item.lang !== 'sv' ? item.lang : undefined}
        onChange={(e) => onChange({ text: e.target.value })}
      />
    </>
  )
}

function Flashcard({ item, onChange, disabled }: ItemInputProps) {
  const [flipped, setFlipped] = useState(false)
  return (
    <div className={styles.flashcard}>
      <button
        type="button"
        className={[styles.card, flipped && styles.flipped].filter(Boolean).join(' ')}
        aria-pressed={flipped}
        onClick={() => setFlipped((f) => !f)}
      >
        <span className={styles.cardHint}>{flipped ? 'Baksida' : 'Tryck för att vända kortet'}</span>
        <span className={styles.cardText} lang={item.lang && item.lang !== 'sv' ? item.lang : undefined}>
          {flipped ? item.back : item.prompt}
        </span>
      </button>
      {flipped && (
        <div className={styles.ratings} role="group" aria-label="Hur gick det?">
          {RATINGS.map((r) => (
            <button
              key={r.v}
              type="button"
              className={styles.tile}
              disabled={disabled}
              onClick={() => onChange(r.v, true)}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
