import { Link, useSearchParams } from 'react-router'
import { paths, useResource, type ArtifactSummary, type Subject } from './api'
import { Field } from './fields'
import { useLearner } from './context'
import { Creations } from './Creations'
import { APPROVAL, ARTIFACT_TYPE, formatDate } from './labels'
import s from './adult.module.css'

const FILTERS = ['type', 'approval', 'subject'] as const

/** `/vuxen/elev/:id/material`: generated material, filterable by type, approval and subject. */
export function Library() {
  const { learner } = useLearner()
  const [params, setParams] = useSearchParams()
  const q = new URLSearchParams()
  for (const f of FILTERS) if (params.get(f)) q.set(f, params.get(f)!)
  const list = useResource<ArtifactSummary[]>(paths.artifacts(learner.id, q.size ? `?${q}` : ''))
  const subjects = useResource<{ subjects: Subject[] }>(paths.subjects(learner.school))
  const subjectName = (code?: string | null) => subjects.data?.subjects.find((x) => x.code === code)?.name ?? code
  const setFilter = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next, { replace: true })
  }

  return (
    <div className={s.stack}>
      <Creations onFinished={list.reload} />
      <div className={s.formGrid} role="group" aria-label="Filter">
        <Field label="Typ">
          {(id) => (
            <select id={id} value={params.get('type') ?? ''} onChange={(e) => setFilter('type', e.target.value)}>
              <option value="">Alla</option>
              {Object.entries(ARTIFACT_TYPE).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Status">
          {(id) => (
            <select
              id={id}
              value={params.get('approval') ?? ''}
              onChange={(e) => setFilter('approval', e.target.value)}
            >
              <option value="">Alla</option>
              {Object.entries(APPROVAL).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Ämne">
          {(id) => (
            <select id={id} value={params.get('subject') ?? ''} onChange={(e) => setFilter('subject', e.target.value)}>
              <option value="">Alla</option>
              {subjects.data?.subjects.map((x) => (
                <option key={x.code} value={x.code}>
                  {x.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {list.error && <p className={s.msg}>{list.error.message}</p>}
      {list.data?.length === 0 && (
        <p className={s.muted}>
          Inget material här ännu. <Link to={`/vuxen/elev/${learner.id}/skapa`}>Skapa material</Link>
        </p>
      )}
      <ul className={s.list}>
        {list.data?.map((a) => (
          <li key={a.id} className={s.listRow}>
            <Link to={a.id}>{a.title}</Link>
            <span className={s.muted}>
              {ARTIFACT_TYPE[a.type]}
              {a.subjectCode ? ` · ${subjectName(a.subjectCode)}` : ''} · {formatDate(a.updatedAt ?? a.createdAt)}
              {a.createdBy === 'learner' ? ' · önskat av eleven' : ''}
            </span>
            <span className={`${s.badge} ${s[`ap_${a.approval}`] ?? ''}`}>{APPROVAL[a.approval]}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
