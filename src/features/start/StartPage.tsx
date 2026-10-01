import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { AgeBand } from '../../../shared/contracts'
import { ApiRequestError } from '../../api/client'
import { Shell } from '../../ui/Shell'
import { SpeakButton } from '../../ui/SpeakButton'
import { adultApi, paths, useResource, type GateState, type LearnerListItem } from '../adult/api'
import { schoolLabel } from '../adult/labels'
import { LearnerBasics } from '../adult/LearnerBasics'
import { NewPin, PinPad } from '../adult/PinPad'
import s from './Start.module.css'

// Calm, neutral marks per age band (no cartoon art: siblings of all ages share the picker).
const BAND_ICON: Record<AgeBand, string> = {
  early: 'M12 4 L14.4 9.2 L20 9.8 L15.8 13.6 L17 19.2 L12 16.3 L7 19.2 L8.2 13.6 L4 9.8 L9.6 9.2 Z',
  middle: 'M12 3 A9 9 0 1 0 12 21 A9 9 0 1 0 12 3 M15.5 8.5 L13.5 13.5 L8.5 15.5 L10.5 10.5 Z',
  upper: 'M3 6 Q7.5 4.5 12 6.5 Q16.5 4.5 21 6 V19 Q16.5 17.5 12 19.5 Q7.5 17.5 3 19 Z M12 6.5 V19.5',
}

function BandIcon({ band }: { band: AgeBand }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={s.icon}>
      <path
        d={BAND_ICON[band]}
        fill={band === 'early' ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={band === 'early' ? 1 : 2}
        strokeLinejoin="round"
      />
    </svg>
  )
}

function Picker({ learners }: { learners: LearnerListItem[] }) {
  return (
    <Shell title="Vem ska lära sig?" home={false}>
      <ul className={s.grid}>
        {learners.map((l) => (
          <li key={l.id} className={`${s.cardWrap} ${s[l.ageBand]}`} role="group" aria-label={l.displayName}>
            <Link to={`/l/${l.id}`} className={s.card}>
              <BandIcon band={l.ageBand} />
              <span className={s.name}>{l.displayName}</span>
              <span className={s.year}>{schoolLabel(l.school)}</span>
            </Link>
            <SpeakButton text={l.displayName} />
          </li>
        ))}
      </ul>
      <footer className={s.footer}>
        <Link to="/vuxen" className={s.adult}>
          För vuxna
        </Link>
      </footer>
    </Shell>
  )
}

function Setup({ gate, onGate }: { gate: GateState; onGate: (g: GateState) => void }) {
  const navigate = useNavigate()
  const [msg, setMsg] = useState('')
  const step = !gate.pinSet ? 1 : !gate.adult ? 'unlock' : 2
  const send = async (path: string, pin: string) => {
    setMsg('')
    try {
      onGate(await adultApi.post<GateState>(path, { pin }))
    } catch (e) {
      setMsg(
        e instanceof ApiRequestError && e.status === 429
          ? 'För många försök. Vänta en minut och försök sedan igen.'
          : e instanceof ApiRequestError && e.code === 'wrong_pin'
            ? 'Det blev inte rätt. Försök igen.'
            : 'Det gick inte just nu. Försök igen.',
      )
    }
  }
  return (
    <Shell title="Välkommen till JackApp" home={false}>
      <div className={s.setup}>
        {step === 1 && (
          <section aria-labelledby="s1">
            <p className={s.step}>Steg 1 av 2</p>
            <h2 id="s1">Skapa en vuxenkod</h2>
            <p className={s.muted}>
              Koden skyddar vuxendelen, där du ställer in profiler och skapar material. Barnen behöver den inte.
            </p>
            <NewPin onDone={(p) => send('/gate/pin', p)} />
          </section>
        )}
        {step === 'unlock' && (
          <section aria-labelledby="su">
            <h2 id="su">Skriv vuxenkoden</h2>
            <p className={s.muted}>Lägg till den första eleven. Det kräver vuxenkoden.</p>
            <PinPad label="Vuxenkod" submitLabel="Öppna" onSubmit={(p) => send('/gate/unlock', p)} />
          </section>
        )}
        {step === 2 && (
          <section aria-labelledby="s2">
            <p className={s.step}>Steg 2 av 2</p>
            <h2 id="s2">Lägg till den första eleven</h2>
            <LearnerBasics submitLabel="Klar" onCreated={() => navigate('/vuxen')} />
          </section>
        )}
        <p className={s.msg} role="status">
          {msg}
        </p>
      </div>
    </Shell>
  )
}

/** `/`: first-run setup, otherwise the learner picker. */
export function StartPage() {
  const gate = useResource<GateState>(paths.gate)
  const learners = useResource<LearnerListItem[]>(paths.learners)
  if (!gate.data || !learners.data)
    return (
      <Shell title="JackApp" home={false}>
        <p role="status" className={s.muted}>
          {gate.error || learners.error ? 'JackApp går inte att nå just nu. Försök igen om en stund.' : 'Startar …'}
        </p>
      </Shell>
    )
  if (!gate.data.pinSet || learners.data.length === 0) return <Setup gate={gate.data} onGate={gate.set} />
  return <Picker learners={learners.data} />
}
