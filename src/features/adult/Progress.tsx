import { useCallback, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import type { JobStatus, SkillSummary } from '../../../shared/contracts'
import { Button } from '../../ui/Button'
import {
  adultApi,
  errorText,
  paths,
  useResource,
  type LearningPath,
  type NextStep,
  type SkillsResponse,
  type StudySet,
  type Subject,
} from './api'
import { Field } from './fields'
import { JobProgress } from './JobProgress'
import { useLearner } from './context'
import { formatDate, skillName } from './labels'
import { RunHistory } from './slots'
import s from './adult.module.css'

const STATUS: Record<SkillSummary['status'], string> = {
  new: 'Nytt',
  practising: 'Övar',
  secure: 'Går bra',
  needsSupport: 'Behöver stöd',
}
const MILESTONE: Record<string, string> = { upcoming: 'Kommande', active: 'Pågår', done: 'Klar' }
const PATH_STATUS: Record<LearningPath['status'], string> = {
  active: 'Pågår',
  paused: 'Pausad',
  completed: 'Klar',
}

function Skills({ data, subjectName }: { data: SkillsResponse; subjectName: (c: string) => string }) {
  // Group by subject, else by the root of the skill tag ("math.addition" → "math").
  const groups = new Map<string, SkillSummary[]>()
  for (const k of data.skills) {
    const g = k.subjectCode ? subjectName(k.subjectCode) : k.skill.split('.')[0]!
    groups.set(g, [...(groups.get(g) ?? []), k])
  }
  if (!data.skills.length) return <p className={s.muted}>Inga svar ännu. Här syns det när eleven har övat.</p>
  return (
    <div className={s.stack}>
      {[...groups].map(([g, list]) => (
        <div key={g}>
          <h4>{g}</h4>
          <ul className={s.list}>
            {list.map((k) => (
              <li key={k.skill} className={s.listRow}>
                <span>{k.note ?? skillName(k.skill)}</span>
                <span className={s.muted}>
                  {k.evidenceCount} svar{k.lastPracticedAt ? ` · senast ${formatDate(k.lastPracticedAt)}` : ''}
                </span>
                <span className={`${s.badge} ${s[`st_${k.status}`] ?? ''}`}>{STATUS[k.status]}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function NewPath({ onCreated }: { onCreated: () => void }) {
  const { learner } = useLearner()
  const subjects = useResource<{ subjects: Subject[] }>(paths.subjects(learner.school))
  const sets = useResource<StudySet[]>(paths.studySets(learner.id))
  const [f, setF] = useState({ goal: '', subjectCode: '', targetDate: '', studySetId: '' })
  const [jobId, setJobId] = useState<string>()
  const [msg, setMsg] = useState('')
  const onDone = useCallback(
    (st: JobStatus) => {
      if (st.state === 'completed') {
        setJobId(undefined)
        setF({ goal: '', subjectCode: '', targetDate: '', studySetId: '' })
        onCreated()
      }
    },
    [onCreated],
  )
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setMsg('')
    const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v))
    try {
      setJobId((await adultApi.post<{ jobId: string }>(paths.learningPaths(learner.id), body)).jobId)
    } catch (err) {
      setMsg(errorText(err))
    }
  }
  return (
    <form onSubmit={submit} className={s.stack} aria-label="Ny studieväg">
      <Field label="Mål" help="Till exempel: Klara provet om bråk.">
        {(id, d) => (
          <input
            id={id}
            required
            maxLength={300}
            aria-describedby={d}
            value={f.goal}
            onChange={(e) => setF({ ...f, goal: e.target.value })}
          />
        )}
      </Field>
      <div className={s.formGrid}>
        <Field label="Ämne">
          {(id) => (
            <select id={id} value={f.subjectCode} onChange={(e) => setF({ ...f, subjectCode: e.target.value })}>
              <option value="">Inget särskilt</option>
              {subjects.data?.subjects.map((x) => (
                <option key={x.code} value={x.code}>
                  {x.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Måldatum">
          {(id) => (
            <input
              id={id}
              type="date"
              value={f.targetDate}
              onChange={(e) => setF({ ...f, targetDate: e.target.value })}
            />
          )}
        </Field>
        <Field label="Studiematerial">
          {(id) => (
            <select id={id} value={f.studySetId} onChange={(e) => setF({ ...f, studySetId: e.target.value })}>
              <option value="">Inget</option>
              {sets.data
                ?.filter((x) => x.status === 'ready')
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                  </option>
                ))}
            </select>
          )}
        </Field>
      </div>
      <div>
        <Button type="submit" disabled={!!jobId || !f.goal.trim()}>
          Planera studievägen
        </Button>
      </div>
      <p role="status" className={s.msg}>
        {msg}
      </p>
      {jobId && <JobProgress key={jobId} jobId={jobId} onDone={onDone} />}
    </form>
  )
}

function PathCard({ p, onChange }: { p: LearningPath; onChange: () => void }) {
  const { learner } = useLearner()
  const [confirm, setConfirm] = useState(false)
  const [msg, setMsg] = useState('')
  const base = `${paths.learningPaths(learner.id)}/${p.id}`
  const run = (fn: () => Promise<unknown>) => fn().then(onChange, (e) => setMsg(errorText(e)))
  return (
    <li className={s.card}>
      <div className={s.cardHead}>
        <h4>{p.goal}</h4>
        <span className={s.badge}>{PATH_STATUS[p.status]}</span>
      </div>
      {p.targetDate && <p className={s.muted}>Mål: {formatDate(p.targetDate)}</p>}
      <ol className={s.plain}>
        {p.milestones.map((m) => (
          <li key={m.id}>
            {m.title} <span className={s.muted}>({MILESTONE[m.status]})</span>
          </li>
        ))}
      </ol>
      <div className={s.row}>
        {p.status === 'active' && (
          <Button variant="secondary" onClick={() => run(() => adultApi.post(`${base}/pause`))}>
            Pausa
          </Button>
        )}
        {p.status === 'paused' && (
          <Button variant="secondary" onClick={() => run(() => adultApi.post(`${base}/resume`))}>
            Fortsätt
          </Button>
        )}
        {confirm ? (
          <>
            <Button onClick={() => run(() => adultApi.del(base))}>Ja, ta bort studievägen</Button>
            <Button variant="quiet" onClick={() => setConfirm(false)}>
              Avbryt
            </Button>
          </>
        ) : (
          <Button variant="quiet" onClick={() => setConfirm(true)}>
            Ta bort
          </Button>
        )}
      </div>
      <p role="status" className={s.msg}>
        {msg}
      </p>
    </li>
  )
}

/** `/vuxen/elev/:id/framsteg`: skills, patterns, next steps, learning paths and run history. */
export function Progress() {
  const { learner } = useLearner()
  const navigate = useNavigate()
  const skills = useResource<SkillsResponse>(paths.skills(learner.id))
  const next = useResource<NextStep[]>(paths.next(learner.id))
  const lp = useResource<LearningPath[]>(paths.learningPaths(learner.id))
  const subjects = useResource<{ subjects: Subject[] }>(paths.subjects(learner.school))
  const subjectName = (c: string) => subjects.data?.subjects.find((x) => x.code === c)?.name ?? c

  return (
    <div className={s.stack}>
      <section className={s.card} aria-labelledby="next-h">
        <h2 id="next-h">Förslag på nästa steg</h2>
        {next.data?.length === 0 && <p className={s.muted}>Inga förslag just nu.</p>}
        <ul className={s.list}>
          {next.data?.map((st, i) => (
            <li key={i} className={s.listRow}>
              <span>
                <strong>{st.title}</strong>
                <br />
                <span className={s.muted}>{st.reason}</span>
              </span>
              <Button
                variant="secondary"
                aria-label={`Skapa: ${st.title}`}
                onClick={() => navigate(`/vuxen/elev/${learner.id}/skapa`, { state: { draft: st.request } })}
              >
                Skapa
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section className={s.card} aria-labelledby="skills-h">
        <h2 id="skills-h">Färdigheter</h2>
        <p className={s.muted}>Bygger på elevens svar. Ger en riktning, inte ett betyg.</p>
        {skills.data && <Skills data={skills.data} subjectName={subjectName} />}
        {skills.data && skills.data.patterns.length > 0 && (
          <>
            <h3>Mönster</h3>
            <ul className={s.plain}>
              {skills.data.patterns.map((p, i) => (
                <li key={i}>{p.note}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className={s.card} aria-labelledby="paths-h">
        <h2 id="paths-h">Studievägar</h2>
        <ul className={s.grid}>
          {lp.data?.map((p) => (
            <PathCard key={p.id} p={p} onChange={lp.reload} />
          ))}
        </ul>
        <details>
          <summary>Ny studieväg</summary>
          <NewPath onCreated={lp.reload} />
        </details>
      </section>

      <section className={s.card} aria-labelledby="runs-h">
        <h2 id="runs-h">Genomförda övningar</h2>
        <RunHistory learnerId={learner.id} />
      </section>
    </div>
  )
}
