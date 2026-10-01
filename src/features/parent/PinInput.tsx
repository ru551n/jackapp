import { useState, type FormEvent } from 'react'
import { Button } from '../../ui/Button'
import s from './parent.module.css'

/** 4-digit entry with keypad and keyboard. Calls onSubmit with the digits once 4 are entered. */
export function PinInput({
  label,
  submitLabel,
  onSubmit,
}: {
  label: string
  submitLabel: string
  onSubmit: (pin: string) => void
}) {
  const [pin, setPin] = useState('')
  const set = (v: string) => setPin(v.replace(/\D/g, '').slice(0, 4))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (pin.length === 4) {
      onSubmit(pin)
      setPin('')
    }
  }
  return (
    <form onSubmit={submit} className={s.field}>
      <label htmlFor="pin-input">{label}</label>
      <input
        id="pin-input"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={pin}
        onChange={(e) => set(e.target.value)}
      />
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
        <Button type="submit" disabled={pin.length !== 4}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

/** Choose a new PIN: enter twice. */
export function NewPin({ onDone }: { onDone: (pin: string) => void }) {
  const [first, setFirst] = useState<string | null>(null)
  const [msg, setMsg] = useState('')
  return (
    <div className={s.field}>
      {first === null ? (
        <PinInput
          key="a"
          label="Välj en kod med 4 siffror"
          submitLabel="Nästa"
          onSubmit={(p) => {
            setFirst(p)
            setMsg('')
          }}
        />
      ) : (
        <PinInput
          key="b"
          label="Skriv koden en gång till"
          submitLabel="Spara koden"
          onSubmit={(p) => {
            if (p === first) onDone(p)
            else {
              setFirst(null)
              setMsg('Koderna var olika. Försök igen.')
            }
          }}
        />
      )}
      {msg && (
        <p className={s.msg} role="status">
          {msg}
        </p>
      )}
    </div>
  )
}
