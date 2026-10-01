import { useState } from 'react'
import { actions } from '../../store/store'
import { Button } from '../../ui/Button'
import { NewPin } from './PinInput'
import s from './parent.module.css'

export function DataPanel() {
  const [confirm, setConfirm] = useState(false)
  const [changing, setChanging] = useState(false)
  return (
    <section className={s.card} aria-labelledby="data-h">
      <h2 id="data-h">Data och kod</h2>
      <p className={s.muted}>
        Allt sparas bara i den här webbläsaren på den här enheten (localStorage). Om du rensar webbläsarens data
        försvinner framstegen.
      </p>
      <div className={s.row}>
        {confirm ? (
          <>
            <span>Ta bort alla framsteg och fordon? Inställningar och kod behålls.</span>
            <Button
              onClick={() => {
                actions.resetProgress()
                setConfirm(false)
              }}
            >
              Ja, nollställ
            </Button>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Avbryt
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={() => setConfirm(true)}>
            Nollställ framsteg
          </Button>
        )}
      </div>
      {changing ? (
        <>
          <NewPin
            onDone={(p) => {
              actions.setParentPin(p)
              setChanging(false)
            }}
          />
          <div>
            <Button variant="quiet" onClick={() => setChanging(false)}>
              Avbryt
            </Button>
          </div>
        </>
      ) : (
        <div>
          <Button variant="secondary" onClick={() => setChanging(true)}>
            Byt kod
          </Button>
        </div>
      )}
    </section>
  )
}
