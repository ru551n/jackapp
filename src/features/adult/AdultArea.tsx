import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router'
import { ApiRequestError } from '../../api/client'
import { About } from './About'
import { ADULT_REQUIRED_EVENT, adultApi, paths, useResource, type GateState } from './api'
import { ArtifactView } from './ArtifactView'
import { Generate } from './Generate'
import { LearnerLayout } from './LearnerLayout'
import { Library } from './Library'
import { NewLearner } from './NewLearner'
import { Overview } from './Overview'
import { LockContext } from './context'
import { Page } from './Page'
import { NewPin, PinPad } from './PinPad'
import { ProfileEditor } from './ProfileEditor'
import { Progress } from './Progress'
import { Uploads } from './Uploads'
import s from './adult.module.css'

function GateScreen({ gate, onOpen }: { gate: GateState; onOpen: (g: GateState) => void }) {
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async (path: string, pin: string) => {
    setBusy(true)
    setMsg('')
    try {
      onOpen(await adultApi.post<GateState>(path, { pin }))
    } catch (e) {
      setMsg(
        e instanceof ApiRequestError && e.status === 429
          ? 'För många försök. Vänta en minut och försök sedan igen.'
          : e instanceof ApiRequestError && e.code === 'wrong_pin'
            ? 'Det blev inte rätt. Försök igen.'
            : 'Det gick inte att låsa upp just nu. Försök igen.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <Page title="För vuxna">
      <section className={`${s.card} ${s.narrow}`} aria-labelledby="gate-h">
        <h2 id="gate-h">{gate.pinSet ? 'Skriv vuxenkoden' : 'Skapa en vuxenkod'}</h2>
        {gate.pinSet ? (
          <>
            <p className={s.muted}>Den här delen är för vuxna i hushållet.</p>
            <PinPad label="Vuxenkod" submitLabel="Öppna" disabled={busy} onSubmit={(p) => send('/gate/unlock', p)} />
            <p className={s.msg} role="status">
              {msg}
            </p>
            <p className={s.muted}>Glömt koden? Den som driftar JackApp kan nollställa den.</p>
          </>
        ) : (
          <>
            <p className={s.muted}>Koden håller barnen utanför vuxendelen på den här enheten.</p>
            <NewPin disabled={busy} onDone={(p) => send('/gate/pin', p)} />
            <p className={s.msg} role="status">
              {msg}
            </p>
          </>
        )}
      </section>
    </Page>
  )
}

/** `/vuxen/*`: the adult area behind the household PIN gate. */
export function AdultArea() {
  const gate = useResource<GateState>(paths.gate)
  const navigate = useNavigate()
  const { data, set } = gate

  useEffect(() => {
    const relock = () => data && set({ ...data, adult: false })
    window.addEventListener(ADULT_REQUIRED_EVENT, relock)
    return () => window.removeEventListener(ADULT_REQUIRED_EVENT, relock)
  }, [data, set])

  if (!data)
    return (
      <Page title="För vuxna">
        <p role="status" className={s.muted}>
          {gate.error ? gate.error.message : 'Hämtar …'}
        </p>
      </Page>
    )
  if (!data.adult || !data.pinSet) return <GateScreen gate={data} onOpen={set} />

  const lock = () => {
    void adultApi.post('/gate/lock').finally(() => {
      set({ ...data, adult: false })
      navigate('/')
    })
  }
  return (
    <LockContext.Provider value={lock}>
      <Routes>
        <Route index element={<Overview />} />
        <Route path="ny" element={<NewLearner />} />
        <Route path="om" element={<About />} />
        <Route path="elev/:id" element={<LearnerLayout />}>
          <Route index element={<ProfileEditor />} />
          <Route path="skapa" element={<Generate />} />
          <Route path="material" element={<Library />} />
          <Route path="material/:artifactId" element={<ArtifactView />} />
          <Route path="framsteg" element={<Progress />} />
          <Route path="studiematerial/*" element={<Uploads />} />
        </Route>
        <Route path="*" element={<Navigate to="/vuxen" replace />} />
      </Routes>
    </LockContext.Provider>
  )
}
