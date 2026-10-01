import { useCallback, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router'
import type { CurriculumRef, JobStatus, SourceMode, SupportPreferences } from '../../../shared/contracts'
import { Button } from '../../ui/Button'
import {
  adultApi,
  errorText,
  paths,
  useResource,
  type GenerationRequest,
  type StudySet,
  type Subject,
  type SuggestedRef,
  type SystemStatus,
} from './api'
import { Choice, Field, Toggle } from './fields'
import { JobProgress } from './JobProgress'
import { StudyUpload } from '../study'
import { useLearner } from './context'
import {
  ARTIFACT_TYPE,
  DIFFICULTY,
  ITEM_KIND,
  NO_IMAGE_SOURCE,
  noImageSource,
  SOURCE_MODE,
  SUPPORT_CHOICES,
  SUPPORT_NOTE,
} from './labels'
import s from './adult.module.css'

type Req = Partial<Omit<GenerationRequest, 'learnerId'>>

const EXAMPLE =
  'Skapa 10 matteuppgifter för årskurs 4 om multiplikation. Använd tåg som tema, lite text och mycket visuellt stöd.'

const num = (v: string) => (v === '' ? undefined : Number(v))

function CurriculumSearch({ req, set }: { req: Req; set: <K extends keyof Req>(k: K, v: Req[K]) => void }) {
  const { learner } = useLearner()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SuggestedRef[]>([])
  const [msg, setMsg] = useState('')
  const chosen = req.curriculumRefs ?? []
  const key = (r: CurriculumRef) => `${r.subjectCode}:${r.itemId ?? r.span ?? ''}`
  const has = (r: CurriculumRef) => chosen.some((c) => key(c) === key(r))
  const search = async () => {
    const school = req.school ?? learner.school
    const params = new URLSearchParams({ q, stage: school.stage, year: String(school.year) })
    if (req.subjectCode) params.set('subject', req.subjectCode)
    try {
      const r = await adultApi.get<{ results: SuggestedRef[] }>(`/curriculum/search?${params}`)
      setHits(r.results)
      setMsg(r.results.length ? '' : 'Inget i läroplanen matchade sökningen.')
    } catch (e) {
      setMsg(errorText(e))
    }
  }
  return (
    <fieldset className={s.choice}>
      <legend>Koppla till läroplanen (valfritt)</legend>
      <div className={s.row}>
        <label htmlFor="cur-q" className="visually-hidden">
          Sök i läroplanen
        </label>
        <input
          id="cur-q"
          value={q}
          placeholder="t.ex. multiplikation"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void search()
            }
          }}
        />
        <Button variant="secondary" disabled={q.trim().length < 2} onClick={search}>
          Sök i läroplanen
        </Button>
      </div>
      <p role="status" className={s.muted}>
        {msg}
      </p>
      {[
        ...chosen
          .filter((c) => !hits.some((h) => key(h.ref) === key(c)))
          .map((ref): Pick<SuggestedRef, 'ref' | 'text'> & Partial<SuggestedRef> => ({ ref, text: key(ref) })),
        ...hits,
      ].map((h) => (
        <Toggle
          key={key(h.ref)}
          label={h.text}
          help={h.subjectName && `${h.subjectName}${h.area ? ` · ${h.area}` : ''}`}
          checked={has(h.ref)}
          onChange={(on) =>
            set('curriculumRefs', on ? [...chosen, h.ref] : chosen.filter((c) => key(c) !== key(h.ref)))
          }
        />
      ))}
    </fieldset>
  )
}

/** `/vuxen/elev/:id/skapa`: natural-language request plus optional form controls. */
export function Generate() {
  const { learner } = useLearner()
  const location = useLocation()
  const [req, setReq] = useState<Req>(() => {
    const draft = (location.state as { draft?: GenerationRequest } | null)?.draft
    if (!draft) return {}
    const { learnerId: _l, ...rest } = draft
    return rest
  })
  const [jobId, setJobId] = useState<string>()
  const [result, setResult] = useState<JobStatus>()
  const [msg, setMsg] = useState('')
  const status = useResource<SystemStatus>(paths.status)
  const subjects = useResource<{ subjects: Subject[] }>(paths.subjects(req.school ?? learner.school))
  const sets = useResource<StudySet[]>(paths.studySets(learner.id))
  const ready = sets.data?.filter((x) => x.status === 'ready') ?? []
  // Inline upload: new pictures become a study set that is selected as soon as it has been read.
  const [uploading, setUploading] = useState(false)
  const [reading, setReading] = useState(false)
  const features = status.data?.features

  const set = <K extends keyof Req>(k: K, v: Req[K]) =>
    setReq((r) => {
      const next = { ...r }
      if (v === undefined || v === '') delete next[k]
      else next[k] = v
      return next
    })
  const setSupport = (k: keyof SupportPreferences, v: string | number | undefined) => {
    const support = { ...req.support, [k]: v }
    if (v === '' || v === undefined) delete support[k]
    set('support', Object.keys(support).length ? support : undefined)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setMsg('')
    setResult(undefined)
    if (uploading) {
      setMsg(reading ? 'Väntar på att bilderna ska läsas klart.' : 'Ladda upp bilderna först, eller välj Inget.')
      return
    }
    if (!req.instructions?.trim() && !req.type) {
      setMsg('Beskriv vad du vill skapa, eller välj en typ av material.')
      return
    }
    try {
      const r = await adultApi.post<{ jobId: string }>(`/learners/${learner.id}/generate`, req)
      setJobId(r.jobId)
    } catch (err) {
      setMsg(errorText(err))
    }
  }
  const onDone = useCallback((st: JobStatus) => setResult(st), [])
  const busy = !!jobId && !result

  return (
    <form onSubmit={submit} className={s.stack}>
      <section className={s.card}>
        <Field label="Vad vill du skapa?" help={`Skriv fritt, till exempel: ”${EXAMPLE}”`}>
          {(id, d) => (
            <textarea
              id={id}
              rows={4}
              maxLength={2000}
              aria-describedby={d}
              value={req.instructions ?? ''}
              onChange={(e) => set('instructions', e.target.value)}
            />
          )}
        </Field>
        <p className={s.muted}>Det du väljer nedan går före det du skrivit. Allt annat hämtas från profilen.</p>
      </section>

      <details className={s.card}>
        <summary>Fler val</summary>
        <div className={s.stack}>
          <div className={s.formGrid}>
            <Field label="Typ av material">
              {(id) => (
                <select
                  id={id}
                  value={req.type ?? ''}
                  onChange={(e) => set('type', (e.target.value || undefined) as Req['type'])}
                >
                  <option value="">Låt JackApp välja</option>
                  {Object.entries(ARTIFACT_TYPE).map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Ämne">
              {(id) => (
                <select id={id} value={req.subjectCode ?? ''} onChange={(e) => set('subjectCode', e.target.value)}>
                  <option value="">Inget särskilt</option>
                  {subjects.data?.subjects.map((x) => (
                    <option key={x.code} value={x.code}>
                      {x.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Område">
              {(id) => (
                <input
                  id={id}
                  maxLength={300}
                  placeholder="t.ex. multiplikation"
                  value={req.topic ?? ''}
                  onChange={(e) => set('topic', e.target.value)}
                />
              )}
            </Field>
            <Field label="Svårighet">
              {(id) => (
                <select id={id} value={req.difficulty ?? ''} onChange={(e) => set('difficulty', num(e.target.value))}>
                  <option value="">Utifrån profilen</option>
                  {Object.entries(DIFFICULTY).map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Antal uppgifter">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={1}
                  max={60}
                  value={req.questionCount ?? ''}
                  onChange={(e) => set('questionCount', num(e.target.value))}
                />
              )}
            </Field>
            <Field label="Ungefärlig tid (minuter)">
              {(id) => (
                <input
                  id={id}
                  type="number"
                  min={3}
                  max={120}
                  value={req.durationMinutes ?? ''}
                  onChange={(e) => set('durationMinutes', num(e.target.value))}
                />
              )}
            </Field>
            <Field label="Tema">
              {(id) => (
                <input
                  id={id}
                  maxLength={100}
                  placeholder="t.ex. tåg"
                  value={req.theme ?? ''}
                  onChange={(e) => set('theme', e.target.value)}
                />
              )}
            </Field>
          </div>

          <fieldset className={s.choice}>
            <legend>Sorters uppgifter</legend>
            <p className={s.muted}>Inget valt betyder att JackApp väljer det som passar.</p>
            <div className={s.options}>
              {Object.entries(ITEM_KIND).map(([k, t]) => (
                <label key={k} className={s.option}>
                  <input
                    type="checkbox"
                    checked={req.itemKinds?.includes(k) ?? false}
                    onChange={(e) => {
                      const kinds = (req.itemKinds ?? []).filter((x) => x !== k)
                      if (e.target.checked) kinds.push(k)
                      set('itemKinds', kinds.length ? kinds : undefined)
                    }}
                  />
                  {t}
                </label>
              ))}
            </div>
          </fieldset>

          <CurriculumSearch req={req} set={set} />

          <Choice
            legend="Återkoppling"
            value={req.feedback ?? 'immediate'}
            options={[
              ['immediate', 'Efter varje uppgift'],
              ['end', 'I slutet (som ett prov)'],
            ]}
            onChange={(v) => set('feedback', v)}
          />
          <Toggle label="Ledtrådar" checked={req.hints ?? true} onChange={(v) => set('hints', v)} />
          <Toggle
            label="Sök fakta på webben"
            help={features && !features.webResearch ? 'Inte tillgängligt just nu.' : 'Källorna visas med materialet.'}
            disabled={features && !features.webResearch}
            checked={req.useWebResearch ?? false}
            onChange={(v) => set('useWebResearch', v)}
          />
          <Toggle
            label="Bilder"
            help={noImageSource(features) ? NO_IMAGE_SOURCE : 'Bara bilder med känd licens används.'}
            disabled={noImageSource(features)}
            checked={req.includeImages ?? false}
            onChange={(v) => set('includeImages', v)}
          />

          <fieldset className={s.choice}>
            <legend>Stöd just för det här materialet</legend>
            <p className={s.muted}>{SUPPORT_NOTE} Det som inte väljs här hämtas från profilen.</p>
            {SUPPORT_CHOICES.map((c) => (
              <Choice
                key={c.key}
                legend={c.legend}
                value={req.support?.[c.key] ?? ''}
                options={[['', 'Som i profilen'], ...c.options]}
                onChange={(v) => setSupport(c.key, v)}
              />
            ))}
          </fieldset>
        </div>
      </details>

      <section className={s.card} aria-labelledby="src-h">
        <h2 id="src-h">Utgå från studiematerial (valfritt)</h2>
        <Field label="Studiematerial">
          {(id) => (
            <select
              id={id}
              value={uploading ? 'new' : (req.studySetId ?? '')}
              onChange={(e) => {
                const v = e.target.value
                setUploading(v === 'new')
                setReading(false)
                set('studySetId', v === 'new' ? undefined : v)
              }}
            >
              <option value="">Inget</option>
              {ready.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title}
                </option>
              ))}
              <option value="new">Ladda upp nya bilder…</option>
            </select>
          )}
        </Field>
        {uploading && (
          <StudyUpload
            learnerId={learner.id}
            variant="adult"
            onUploaded={() => setReading(true)}
            onReady={(setId) => {
              sets.reload()
              setUploading(false)
              setReading(false)
              set('studySetId', setId)
              setMsg('Bilderna är lästa och valda som studiematerial.')
            }}
          />
        )}
        {req.studySetId && (
          <Choice
            legend="Hur materialet används"
            value={req.sourceMode ?? 'sourceAndCurriculum'}
            options={(Object.keys(SOURCE_MODE) as SourceMode[]).map(
              (m) => [m, `${SOURCE_MODE[m].label}: ${SOURCE_MODE[m].help}`] as const,
            )}
            onChange={(v) => set('sourceMode', v)}
          />
        )}
      </section>

      <div className={s.saveBar}>
        <Button type="submit" disabled={busy || reading}>
          Skapa
        </Button>
        <p role="status" className={s.msg}>
          {msg}
        </p>
        {/* Job status lives in the sticky bar so it stays in view below a long form. */}
        {jobId && <JobProgress key={jobId} jobId={jobId} onDone={onDone} />}
        {result?.state === 'completed' && result.resultId && (
          <Link to={`/vuxen/elev/${learner.id}/material/${result.resultId}`}>Öppna materialet</Link>
        )}
        {result?.state === 'failed' && <Link to={`/vuxen/elev/${learner.id}/material`}>Till materialet</Link>}
      </div>
    </form>
  )
}
