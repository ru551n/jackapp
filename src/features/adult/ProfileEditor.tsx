import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import type { LearnerProfile, LearnerProfileInput, SubjectLevel } from '../../../shared/contracts'
import { Button } from '../../ui/Button'
import { adultApi, errorText, paths, useResource, type LegacyImportResult, type Subject } from './api'
import { Choice, Field, Toggle } from './fields'
import { useLearner } from './context'
import { fromSchool, RELATIVE_LEVEL, SCHOOL_OPTIONS, splitList, toSchool } from './labels'
import { SupportFields } from './SupportFields'
import s from './adult.module.css'

const toInput = ({ id: _i, createdAt: _c, updatedAt: _u, ...p }: LearnerProfile): LearnerProfileInput => p

function SubjectLevels({
  value,
  subjects,
  onChange,
}: {
  value: SubjectLevel[]
  subjects: Subject[]
  onChange: (v: SubjectLevel[]) => void
}) {
  const set = (i: number, patch: Partial<SubjectLevel>) =>
    onChange(value.map((l, n) => (n === i ? { ...l, ...patch } : l)))
  const name = (code: string) => subjects.find((x) => x.code === code)?.name ?? code
  return (
    <div className={s.stack}>
      {value.map((l, i) => (
        <fieldset key={i} className={s.choice}>
          <legend>{name(l.subjectCode)}</legend>
          <Field label="Beskrivning" help="Till exempel: läser korta meningar, räknar säkert till 100.">
            {(id, d) => (
              <input
                id={id}
                aria-describedby={d}
                maxLength={500}
                value={l.description}
                onChange={(e) => set(i, { description: e.target.value })}
              />
            )}
          </Field>
          <Field label="Nivå jämfört med årskursen">
            {(id) => (
              <select
                id={id}
                value={l.relativeLevel ?? ''}
                onChange={(e) => set(i, { relativeLevel: e.target.value ? Number(e.target.value) : undefined })}
              >
                <option value="">Vet inte</option>
                {Object.entries(RELATIVE_LEVEL).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <div>
            <Button variant="quiet" onClick={() => onChange(value.filter((_, n) => n !== i))}>
              Ta bort {name(l.subjectCode)}
            </Button>
          </div>
        </fieldset>
      ))}
      <Field label="Lägg till ämne">
        {(id) => (
          <select
            id={id}
            value=""
            onChange={(e) => e.target.value && onChange([...value, { subjectCode: e.target.value, description: '' }])}
          >
            <option value="">Välj ämne …</option>
            {subjects
              .filter((x) => !value.some((l) => l.subjectCode === x.code))
              .map((x) => (
                <option key={x.code} value={x.code}>
                  {x.name}
                </option>
              ))}
          </select>
        )}
      </Field>
    </div>
  )
}

const LEGACY_KEY = 'jackapp:v1'

function readLegacy(): string | null {
  try {
    return localStorage.getItem(LEGACY_KEY)
  } catch {
    return null
  }
}

/** Offer the old single-device progress (localStorage) to this learner. Never deletes local data. */
export function LegacyImport({ learnerId }: { learnerId: string }) {
  const [raw] = useState(readLegacy)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  if (!raw) return null
  const run = async () => {
    setBusy(true)
    try {
      const r = await adultApi.post<LegacyImportResult>(`/learners/${learnerId}/legacy-import`, JSON.parse(raw))
      setMsg(
        r.created
          ? `Klart. Framsteg för ${r.skills} färdigheter importerades.${r.skipped.length ? ` ${r.skipped.length} kunde inte läsas men finns sparade.` : ''}`
          : 'De här framstegen var redan importerade.',
      )
    } catch (e) {
      setMsg(e instanceof SyntaxError ? 'De sparade framstegen gick inte att läsa.' : errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className={s.card} aria-labelledby="legacy-h">
      <h2 id="legacy-h">Tidigare framsteg</h2>
      <p className={s.muted}>
        Den här enheten har framsteg från den tidigare versionen av JackApp. De ligger kvar på enheten även efter
        importen.
      </p>
      <div>
        <Button variant="secondary" disabled={busy} onClick={run}>
          Importera framsteg från den här enheten (tidigare JackApp)
        </Button>
      </div>
      <p role="status">{msg}</p>
    </section>
  )
}

function DeleteLearner({ learner }: { learner: LearnerProfile }) {
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState(false)
  const [msg, setMsg] = useState('')
  return (
    <section className={s.card} aria-labelledby="del-h">
      <h2 id="del-h">Ta bort elev</h2>
      {!confirm ? (
        <div>
          <Button variant="secondary" onClick={() => setConfirm(true)}>
            Ta bort {learner.displayName}
          </Button>
        </div>
      ) : (
        <div className={s.stack} role="group" aria-label="Bekräfta borttagning">
          <p>Allt för {learner.displayName} tas bort: profil, material och framsteg. Det går inte att ångra.</p>
          <div className={s.row}>
            <Button
              onClick={() =>
                adultApi.del(`/learners/${learner.id}`).then(
                  () => navigate('/vuxen'),
                  (e) => setMsg(errorText(e)),
                )
              }
            >
              Ja, ta bort
            </Button>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Avbryt
            </Button>
          </div>
        </div>
      )}
      <p role="status">{msg}</p>
    </section>
  )
}

/** `/vuxen/elev/:id`: every profile field, support preferences, legacy import and delete. */
export function ProfileEditor() {
  const { learner, resource } = useLearner()
  const [p, setP] = useState(() => toInput(learner))
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const subjects = useResource<{ subjects: Subject[] }>(paths.subjects(p.school))
  const upd = (patch: Partial<LearnerProfileInput>) => setP((x) => ({ ...x, ...patch }))
  // Lists are edited as text; kept as strings until save so typing commas works naturally.
  const [lists, setLists] = useState({
    interests: p.interests.join(', '),
    themes: p.themes.join(', '),
    strengths: p.strengths.join('\n'),
    difficulties: p.difficulties.join('\n'),
  })

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    try {
      const saved = await adultApi.patch<LearnerProfile>(paths.learner(learner.id), {
        ...p,
        subjectLevels: p.subjectLevels.filter((l) => l.description.trim()),
        interests: splitList(lists.interests),
        themes: splitList(lists.themes),
        strengths: splitList(lists.strengths, /\n/),
        difficulties: splitList(lists.difficulties, /\n/),
      })
      resource.set(saved)
      setMsg('Sparat.')
    } catch (err) {
      setMsg(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={s.stack}>
      <form onSubmit={save} className={s.stack} aria-label="Profil">
        <section className={s.card} aria-labelledby="basic-h">
          <h2 id="basic-h">Grunduppgifter</h2>
          <Field label="Namn">
            {(id) => (
              <input
                id={id}
                required
                maxLength={60}
                value={p.displayName}
                onChange={(e) => upd({ displayName: e.target.value })}
              />
            )}
          </Field>
          <Field label="Skola och årskurs" help="Styr hur appen ser ut för eleven och vilka ämnen som finns.">
            {(id, d) => (
              <select
                id={id}
                aria-describedby={d}
                value={fromSchool(p.school)}
                onChange={(e) => upd({ school: toSchool(e.target.value) })}
              >
                {SCHOOL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </section>

        <section className={s.card} aria-labelledby="int-h">
          <h2 id="int-h">Intressen och teman</h2>
          <Field label="Intressen" help="Skilj med kommatecken.">
            {(id, d) => (
              <input
                id={id}
                aria-describedby={d}
                value={lists.interests}
                onChange={(e) => setLists({ ...lists, interests: e.target.value })}
              />
            )}
          </Field>
          <Field label="Teman i materialet" help="Skilj med kommatecken. Till exempel tåg, rymden.">
            {(id, d) => (
              <input
                id={id}
                aria-describedby={d}
                value={lists.themes}
                onChange={(e) => setLists({ ...lists, themes: e.target.value })}
              />
            )}
          </Field>
        </section>

        <section className={s.card} aria-labelledby="notes-h">
          <h2 id="notes-h">Styrkor och svårigheter</h2>
          <p className={s.muted}>
            Bara för vuxna. Skickas aldrig till eleven eller till AI-tjänsten. Beskriv vad som fungerar, inte diagnoser.
          </p>
          <Field label="Styrkor" help="En per rad.">
            {(id, d) => (
              <textarea
                id={id}
                rows={3}
                aria-describedby={d}
                value={lists.strengths}
                onChange={(e) => setLists({ ...lists, strengths: e.target.value })}
              />
            )}
          </Field>
          <Field label="Svårigheter" help="En per rad.">
            {(id, d) => (
              <textarea
                id={id}
                rows={3}
                aria-describedby={d}
                value={lists.difficulties}
                onChange={(e) => setLists({ ...lists, difficulties: e.target.value })}
              />
            )}
          </Field>
        </section>

        <section className={s.card} aria-labelledby="lvl-h">
          <h2 id="lvl-h">Nivå per ämne</h2>
          <p className={s.muted}>
            Nivån styr hur svårt innehållet blir. Den är skild från stödet nedan: en elev kan ligga över sin årskurs och
            ändå vilja ha lite text.
          </p>
          <SubjectLevels
            value={p.subjectLevels}
            subjects={subjects.data?.subjects ?? []}
            onChange={(subjectLevels) => upd({ subjectLevels })}
          />
        </section>

        <section className={s.card} aria-labelledby="sup-h">
          <h2 id="sup-h">Stöd i presentationen</h2>
          <SupportFields value={p.support} onChange={(patch) => upd({ support: { ...p.support, ...patch } })} />
        </section>

        <section className={s.card} aria-labelledby="gen-h">
          <h2 id="gen-h">Material och egna önskemål</h2>
          <Toggle
            label="Eleven får be om eget material"
            help="Till exempel ”Jag vill lära mig bråk med flygplan”."
            checked={p.generation.learnerRequestsAllowed}
            onChange={(v) => upd({ generation: { ...p.generation, learnerRequestsAllowed: v } })}
          />
          <Choice
            legend="Nytt material"
            value={p.generation.approval}
            options={[
              ['immediate', 'Kan användas direkt när det klarat kontrollen'],
              ['parent', 'Väntar tills en vuxen godkänt det'],
            ]}
            onChange={(approval) => upd({ generation: { ...p.generation, approval } })}
          />
          <Toggle
            label="Fri lek (Bygg din linje)"
            help="För de yngsta. Avstängt från början."
            checked={p.freePlayEnabled}
            onChange={(freePlayEnabled) => upd({ freePlayEnabled })}
          />
        </section>

        <div className={s.saveBar}>
          <Button type="submit" disabled={busy}>
            Spara profilen
          </Button>
          <p role="status">{msg}</p>
        </div>
      </form>
      <LegacyImport learnerId={learner.id} />
      <DeleteLearner learner={learner} />
    </div>
  )
}
