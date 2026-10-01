import { useState, type FormEvent } from 'react'
import type { Item, MediaRef, ValidationIssue } from '../../../shared/contracts'
import { API_PREFIX } from '../../../shared/contracts'
import { Button } from '../../ui/Button'
import { useResource, type Attribution } from './api'
import { DIFFICULTY, ITEM_KIND } from './labels'
import s from './adult.module.css'

/** " · <link>" for a source or licence URL, nothing when absent. */
export function ExtLink({ href, children }: { href?: string; children: string }) {
  if (!href) return null
  return (
    <>
      {' · '}
      <a href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    </>
  )
}

export function Figure({ media }: { media: MediaRef }) {
  const a = useResource<Attribution>(`/assets/${media.assetId}/attribution`)
  return (
    <figure className={s.figure}>
      <img src={`${API_PREFIX}/assets/${media.assetId}`} alt={media.alt} />
      <figcaption className={s.muted}>
        {media.generated && 'AI-genererad bild. '}
        {/* Credit is shown for every licence, also CC0/PD (courtesy; docs/platform/research-and-licensing.md). */}
        {a.data?.attribution ?? (!media.generated && `Licens: ${media.license.license}`)}
        <ExtLink href={a.data?.sourceUrl ?? media.license.sourceUrl}>källa</ExtLink>
        <ExtLink href={a.data?.licenseUrl ?? media.license.licenseUrl}>licens</ExtLink>
      </figcaption>
    </figure>
  )
}

function Answer({ item }: { item: Item }) {
  const mark = (ok: boolean) => (ok ? <strong> ✓ rätt svar</strong> : null)
  switch (item.kind) {
    case 'multipleChoice':
    case 'multiSelect': {
      const right = item.kind === 'multipleChoice' ? [item.answer] : item.answers
      return (
        <ul className={s.answers}>
          {item.choices.map((c) => (
            <li key={c.id}>
              {c.text}
              {mark(right.includes(c.id))}
              {c.media && <Figure media={c.media} />}
            </li>
          ))}
        </ul>
      )
    }
    case 'trueFalse':
      return <p>Rätt svar: {item.answer ? 'Sant' : 'Falskt'}</p>
    case 'fillBlank':
      return (
        <>
          <p>{item.text}</p>
          <ol className={s.answers}>
            {item.blanks.map((b, i) => (
              <li key={i}>Godtas: {b.accepted.join(' / ')}</li>
            ))}
          </ol>
        </>
      )
    case 'matching':
      return (
        <ul className={s.answers}>
          {item.pairs.map((p, i) => (
            <li key={i}>
              {p.left} → {p.right}
            </li>
          ))}
        </ul>
      )
    case 'ordering':
      return (
        <ol className={s.answers}>
          {item.answer.map((id) => (
            <li key={id}>{item.items.find((x) => x.id === id)?.text ?? id}</li>
          ))}
        </ol>
      )
    case 'numeric':
      return (
        <p>
          Rätt svar: {item.answer}
          {item.unit ? ` ${item.unit}` : ''}
          {item.tolerance ? ` (± ${item.tolerance})` : ''}
        </p>
      )
    case 'freeText':
      return (
        <>
          <p>Ett bra svar tar upp:</p>
          <ul className={s.answers}>
            {item.rubric.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
          {item.sampleAnswer && <p>Exempelsvar: {item.sampleAnswer}</p>}
        </>
      )
    case 'flashcard':
      return <p>Baksida: {item.back}</p>
  }
}

type Patch = Record<string, unknown>

/** Edits the prompt, explanation and answers. Returns only the changed fields. */
function ItemEdit({ item, onSave, onCancel }: { item: Item; onSave: (p: Patch) => void; onCancel: () => void }) {
  const [it, setIt] = useState<Item>(item)
  const upd = (p: Partial<Item>) => setIt((x) => ({ ...x, ...p }) as Item)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const patch: Patch = {}
    for (const [k, v] of Object.entries(it))
      if (JSON.stringify(v) !== JSON.stringify((item as Record<string, unknown>)[k])) patch[k] = v
    onSave(patch)
  }
  const pid = `edit-${item.id}`
  return (
    <form onSubmit={submit} className={s.stack} aria-label="Redigera uppgiften">
      <div className={s.field}>
        <label htmlFor={`${pid}-p`}>Uppgift</label>
        <textarea id={`${pid}-p`} rows={3} value={it.prompt} onChange={(e) => upd({ prompt: e.target.value })} />
      </div>
      {(it.kind === 'multipleChoice' || it.kind === 'multiSelect') && (
        <fieldset className={s.choice}>
          <legend>Svarsalternativ (markera rätt svar)</legend>
          {it.choices.map((c, i) => {
            const right = it.kind === 'multipleChoice' ? it.answer === c.id : it.answers.includes(c.id)
            return (
              <div key={c.id} className={s.row}>
                <input
                  type={it.kind === 'multipleChoice' ? 'radio' : 'checkbox'}
                  name={`${pid}-right`}
                  aria-label={`Rätt svar: alternativ ${i + 1}`}
                  checked={right}
                  onChange={(e) =>
                    it.kind === 'multipleChoice'
                      ? upd({ answer: c.id })
                      : upd({
                          answers: e.target.checked ? [...it.answers, c.id] : it.answers.filter((x) => x !== c.id),
                        })
                  }
                />
                <input
                  aria-label={`Alternativ ${i + 1}`}
                  value={c.text}
                  onChange={(e) =>
                    upd({ choices: it.choices.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)) })
                  }
                />
              </div>
            )
          })}
        </fieldset>
      )}
      {it.kind === 'trueFalse' && (
        <fieldset className={s.choice}>
          <legend>Rätt svar</legend>
          <div className={s.options}>
            {([true, false] as const).map((v) => (
              <label key={String(v)} className={s.option}>
                <input type="radio" name={`${pid}-tf`} checked={it.answer === v} onChange={() => upd({ answer: v })} />
                {v ? 'Sant' : 'Falskt'}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {it.kind === 'numeric' && (
        <div className={s.field}>
          <label htmlFor={`${pid}-n`}>Rätt svar</label>
          <input
            id={`${pid}-n`}
            type="number"
            step="any"
            value={it.answer}
            onChange={(e) => upd({ answer: Number(e.target.value) })}
          />
        </div>
      )}
      {it.kind === 'fillBlank' &&
        it.blanks.map((b, i) => (
          <div key={i} className={s.field}>
            <label htmlFor={`${pid}-b${i}`}>Lucka {i + 1}: godkända svar (skilj med kommatecken)</label>
            <input
              id={`${pid}-b${i}`}
              value={b.accepted.join(', ')}
              onChange={(e) =>
                upd({
                  blanks: it.blanks.map((x, n) =>
                    n === i ? { accepted: e.target.value.split(',').map((v) => v.trim()) } : x,
                  ),
                })
              }
            />
          </div>
        ))}
      {it.kind === 'flashcard' && (
        <div className={s.field}>
          <label htmlFor={`${pid}-back`}>Baksida</label>
          <textarea id={`${pid}-back`} rows={2} value={it.back} onChange={(e) => upd({ back: e.target.value })} />
        </div>
      )}
      {it.kind === 'freeText' && (
        <div className={s.field}>
          <label htmlFor={`${pid}-sa`}>Exempelsvar</label>
          <textarea
            id={`${pid}-sa`}
            rows={3}
            value={it.sampleAnswer ?? ''}
            onChange={(e) => upd({ sampleAnswer: e.target.value })}
          />
        </div>
      )}
      <div className={s.field}>
        <label htmlFor={`${pid}-ex`}>Förklaring efter svaret</label>
        <textarea
          id={`${pid}-ex`}
          rows={2}
          value={it.explanation ?? ''}
          onChange={(e) => upd({ explanation: e.target.value })}
        />
      </div>
      <div className={s.row}>
        <Button type="submit">Spara ändringen</Button>
        <Button variant="secondary" onClick={onCancel}>
          Avbryt
        </Button>
      </div>
    </form>
  )
}

export function ItemView({
  item,
  n,
  issues,
  illustration,
  busy,
  onEdit,
  onRemove,
  onRegenerate,
}: {
  item: Item
  n: number
  issues: ValidationIssue[]
  illustration?: string
  busy: boolean
  onEdit: (patch: Patch) => Promise<boolean>
  onRemove: () => void
  onRegenerate: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  return (
    <li className={s.item} id={`item-${item.id}`}>
      <div className={s.cardHead}>
        <h4>
          {n}. {ITEM_KIND[item.kind]}
        </h4>
        <span className={s.muted}>{DIFFICULTY[item.difficulty]}</span>
      </div>
      {issues.map((i, k) => (
        <p key={k} className={i.severity === 'error' ? s.issueError : s.issueWarn}>
          {i.severity === 'error' ? 'Behöver rättas: ' : 'Att kontrollera: '}
          {i.message}
        </p>
      ))}
      {editing ? (
        <ItemEdit
          item={item}
          onCancel={() => setEditing(false)}
          onSave={async (p) => {
            if (await onEdit(p)) setEditing(false)
          }}
        />
      ) : (
        <>
          <p className={s.prompt}>{item.prompt}</p>
          {item.media.map((m) => (
            <Figure key={m.assetId} media={m} />
          ))}
          {illustration && <p className={s.muted}>Bildförslag: {illustration}</p>}
          <Answer item={item} />
          {item.hints.length > 0 && (
            <p className={s.muted}>Ledtrådar: {item.hints.map((h, i) => `${i + 1}) ${h}`).join(' ')}</p>
          )}
          {item.explanation && <p className={s.muted}>Förklaring: {item.explanation}</p>}
          <div className={s.row}>
            <Button variant="secondary" disabled={busy} onClick={() => setEditing(true)}>
              Redigera
            </Button>
            <Button variant="secondary" disabled={busy} onClick={onRegenerate}>
              Gör om uppgiften
            </Button>
            {confirm ? (
              <>
                <Button disabled={busy} onClick={onRemove}>
                  Ja, ta bort uppgift {n}
                </Button>
                <Button variant="quiet" onClick={() => setConfirm(false)}>
                  Avbryt
                </Button>
              </>
            ) : (
              <Button variant="quiet" disabled={busy} onClick={() => setConfirm(true)}>
                Ta bort
              </Button>
            )}
          </div>
        </>
      )}
    </li>
  )
}
