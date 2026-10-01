import { useState, type FormEvent } from 'react'
import type { LearnerProfile } from '../../../shared/contracts'
import { Button } from '../../ui/Button'
import { adultApi, errorText } from './api'
import { fromSchool, SCHOOL_OPTIONS, splitList, toSchool } from './labels'
import s from './adult.module.css'

/** Create a learner from the essentials: name, school year and interests. */
export function LearnerBasics({
  submitLabel,
  onCreated,
}: {
  submitLabel: string
  onCreated: (l: LearnerProfile) => void
}) {
  const [name, setName] = useState('')
  const [school, setSchool] = useState(fromSchool({ stage: 'grundskola', year: 1 }))
  const [interests, setInterests] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    try {
      const l = await adultApi.post<LearnerProfile>('/learners', {
        displayName: name.trim(),
        school: toSchool(school),
        interests: splitList(interests),
      })
      onCreated(l)
    } catch (err) {
      setMsg(errorText(err))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className={s.stack}>
      <div className={s.field}>
        <label htmlFor="lb-name">Namn</label>
        <input
          id="lb-name"
          value={name}
          maxLength={60}
          required
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className={s.field}>
        <label htmlFor="lb-school">Skola och årskurs</label>
        <select id="lb-school" value={school} onChange={(e) => setSchool(e.target.value)}>
          {SCHOOL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className={s.field}>
        <label htmlFor="lb-int">Intressen</label>
        <input
          id="lb-int"
          value={interests}
          aria-describedby="lb-int-help"
          placeholder="tåg, flygplan, dinosaurier"
          onChange={(e) => setInterests(e.target.value)}
        />
        <p id="lb-int-help" className={s.muted}>
          Skilj med kommatecken. Används som teman i materialet. Kan ändras senare.
        </p>
      </div>
      <p className={s.msg} role="status">
        {msg}
      </p>
      <div>
        <Button type="submit" disabled={busy || !name.trim()}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
