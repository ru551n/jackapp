import { useId, useState, type FormEvent } from 'react'
import { Button } from '../../ui/Button'
import s from './adult.module.css'

const MIN = 4
const MAX = 8

/** PIN entry (4–8 digits): on-screen keypad plus keyboard. */
export function PinPad({
  label,
  submitLabel,
  onSubmit,
  disabled,
}: {
  label: string
  submitLabel: string
  onSubmit: (pin: string) => void
  disabled?: boolean
}) {
  const id = useId()
  const [pin, setPin] = useState('')
  const set = (v: string) => setPin(v.replace(/\D/g, '').slice(0, MAX))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (pin.length < MIN || disabled) return
    onSubmit(pin)
    setPin('')
  }
  return (
    <form onSubmit={submit} className={s.pin}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className={s.pinInput}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        autoFocus
        aria-describedby={`${id}-help`}
        value={pin}
        onChange={(e) => set(e.target.value)}
      />
      <p id={`${id}-help`} className={s.muted}>
        4–8 siffror
      </p>
      <div className={s.keypad}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <button key={d} type="button" onClick={() => set(pin + d)}>
            {d}
          </button>
        ))}
        <button type="button" aria-label="Sudda" onClick={() => setPin(pin.slice(0, -1))}>
          ⌫
        </button>
        <button type="button" onClick={() => set(pin + 0)}>
          0
        </button>
      </div>
      <div>
        <Button type="submit" disabled={pin.length < MIN || disabled}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

/** Choose a new PIN by entering it twice. */
export function NewPin({ onDone, disabled }: { onDone: (pin: string) => void; disabled?: boolean }) {
  const [first, setFirst] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  return (
    <div className={s.stack}>
      {first === null ? (
        <PinPad
          key="a"
          label="Välj en vuxenkod"
          submitLabel="Nästa"
          onSubmit={(p) => {
            setFirst(p)
            setMsg('')
          }}
        />
      ) : (
        <PinPad
          key="b"
          label="Skriv koden en gång till"
          submitLabel="Spara koden"
          disabled={disabled}
          onSubmit={(p) => {
            if (p === first) onDone(p)
            else {
              setFirst(null)
              setMsg('Koderna var olika. Försök igen.')
            }
          }}
        />
      )}
      <p className={s.msg} role="status">
        {msg}
      </p>
    </div>
  )
}
