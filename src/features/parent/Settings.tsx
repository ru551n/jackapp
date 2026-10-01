import { useEffect, useState } from 'react'
import { hasSwedishVoice } from '../../lib/speech'
import { actions, useAppState } from '../../store/store'
import type { Settings as S } from '../../core/types'
import s from './parent.module.css'

function useSwedishVoice() {
  const [has, setHas] = useState(hasSwedishVoice)
  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    const synth = window.speechSynthesis
    const check = () => setHas(hasSwedishVoice())
    synth.addEventListener?.('voiceschanged', check)
    return () => synth.removeEventListener?.('voiceschanged', check)
  }, [])
  return has
}

export function Settings() {
  const set = useAppState((x) => x.settings)
  const voice = useSwedishVoice()
  const toggle = (key: 'sound' | 'speech' | 'freePlayEnabled', label: string, help?: string) => (
    <div>
      <label className={s.check}>
        <input
          type="checkbox"
          checked={set[key]}
          onChange={(e) => actions.updateSettings({ [key]: e.target.checked })}
        />
        {label}
      </label>
      {help && <p className={s.muted}>{help}</p>}
    </div>
  )
  return (
    <section className={s.card} aria-labelledby="set-h">
      <h2 id="set-h">Inställningar</h2>
      {toggle('sound', 'Ljud', 'Mjuka ljudeffekter. Av som standard.')}
      {toggle('speech', 'Uppläsning', 'Visar knappen "Lyssna" som läser upp texten.')}
      {set.speech && !voice && (
        <p className={s.msg} role="status">
          Den här webbläsaren verkar sakna en svensk röst. Uppläsningen kan låta konstig.
        </p>
      )}
      <div className={s.field}>
        <label htmlFor="motion">Rörelse</label>
        <select
          id="motion"
          className={s.select}
          style={{ maxWidth: '14rem' }}
          value={set.motion}
          onChange={(e) => actions.updateSettings({ motion: e.target.value as S['motion'] })}
        >
          <option value="system">Följ enheten</option>
          <option value="reduced">Minskad</option>
          <option value="full">Full</option>
        </select>
      </div>
      {toggle('freePlayEnabled', 'Fri lek "Bygg din linje"', 'Visas på barnets startsida när den är på.')}
    </section>
  )
}
