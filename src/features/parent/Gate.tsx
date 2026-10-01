import { useState, type FormEvent } from 'react'
import { actions, useAppState } from '../../store/store'
import { Button } from '../../ui/Button'
import { NewPin, PinInput } from './PinInput'
import s from './parent.module.css'

function AdultCheck({ onPass }: { onPass: () => void }) {
  const [[a, b]] = useState(() => [10 + Math.floor(Math.random() * 90), 10 + Math.floor(Math.random() * 90)])
  const [v, setV] = useState('')
  const [wrong, setWrong] = useState(false)
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (Number(v) === a + b) onPass()
    else {
      setWrong(true)
      setV('')
    }
  }
  return (
    <form onSubmit={submit} className={s.field}>
      <label htmlFor="adult">
        Skriv svaret:{' '}
        <span data-testid="sum">
          {a} + {b}
        </span>
      </label>
      <input id="adult" inputMode="numeric" autoComplete="off" value={v} onChange={(e) => setV(e.target.value)} />
      {wrong && (
        <p className={s.msg} role="status">
          Det blev inte rätt. Försök igen.
        </p>
      )}
      <div>
        <Button type="submit" disabled={!v}>
          Fortsätt
        </Button>
      </div>
    </form>
  )
}

type Stage = 'pin' | 'check' | 'newpin'

export function Gate({ onUnlock }: { onUnlock: () => void }) {
  const savedPin = useAppState((st) => st.parentPin)
  const [stage, setStage] = useState<Stage>(savedPin ? 'pin' : 'check')
  const [wrong, setWrong] = useState(false)
  return (
    <section className={s.card} aria-labelledby="gate-h">
      <h2 id="gate-h">Vuxenområde</h2>
      {stage === 'pin' && (
        <>
          <PinInput
            label="Skriv din kod"
            submitLabel="Öppna"
            onSubmit={(p) => (p === savedPin ? onUnlock() : setWrong(true))}
          />
          {wrong && (
            <p className={s.msg} role="status">
              Fel kod. Försök igen.
            </p>
          )}
          <div>
            <Button variant="quiet" onClick={() => setStage('check')}>
              Glömt koden?
            </Button>
          </div>
        </>
      )}
      {stage === 'check' && (
        <>
          <p className={s.muted}>Den här delen är för vuxna. Lös uppgiften för att fortsätta.</p>
          <AdultCheck onPass={() => setStage('newpin')} />
        </>
      )}
      {stage === 'newpin' && (
        <NewPin
          onDone={(p) => {
            actions.setParentPin(p)
            onUnlock()
          }}
        />
      )}
    </section>
  )
}
