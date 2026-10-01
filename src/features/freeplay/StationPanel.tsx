import { useEffect, useRef, useState } from 'react'
import { Button } from '../../ui/Button'
import { MAX_NAME, STATION_NAMES } from './model'
import styles from './FreePlay.module.css'

interface Props {
  name: string
  onPick: (name: string) => void
  onClose: () => void
}

export function StationPanel({ name, onPick, onClose }: Props) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])
  const [custom, setCustom] = useState('')
  return (
    <section className={styles.panel} aria-label="Välj namn">
      <h2 ref={heading} tabIndex={-1}>
        Namn på stationen
      </h2>
      <div className={styles.names}>
        {STATION_NAMES.map((n) => (
          <Button key={n} variant={n === name ? 'primary' : 'secondary'} onClick={() => onPick(n)}>
            {n}
          </Button>
        ))}
      </div>
      <form
        className={styles.custom}
        onSubmit={(e) => {
          e.preventDefault()
          if (custom.trim()) onPick(custom)
          setCustom('')
        }}
      >
        <label>
          Eget namn
          <input value={custom} maxLength={MAX_NAME} onChange={(e) => setCustom(e.target.value)} />
        </label>
        <Button variant="secondary" type="submit">
          Spara namn
        </Button>
      </form>
      <Button variant="quiet" onClick={onClose}>
        Klar
      </Button>
    </section>
  )
}
