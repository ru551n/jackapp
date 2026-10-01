import { useCallback, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { Artifact, AssetLicense, Item, JobStatus, MediaRef, SourceRef } from '../../../shared/contracts'
import { ApiRequestError } from '../../api/client'
import { Button } from '../../ui/Button'
import { adultApi, errorText, paths, useResource, type ArtifactResponse, type VersionEntry } from './api'
import { ExtLink, ItemView } from './ItemView'
import { JobProgress } from './JobProgress'
import { useLearner } from './context'
import { APPROVAL, ARTIFACT_TYPE, formatDate, SOURCE_MODE, TRANSFORMS } from './labels'
import s from './adult.module.css'

const ORIGIN: Record<string, string> = {
  generate: 'Skapad',
  edit: 'Redigerad',
  regenerateItem: 'En uppgift gjordes om',
}
const originLabel = (o: string) =>
  ORIGIN[o] ?? (o.startsWith('transform:') ? (TRANSFORMS.find(([k]) => `transform:${k}` === o)?.[1] ?? 'Omarbetad') : o)

function Versions({ id, current }: { id: string; current: number }) {
  const [open, setOpen] = useState(false)
  const list = useResource<VersionEntry[]>(open ? `/artifacts/${id}/versions?v=${current}` : null)
  return (
    <details className={s.card} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Versioner</summary>
      <ol className={s.plain}>
        {list.data?.map((v) => (
          <li key={v.version}>
            Version {v.version}: {originLabel(v.origin)}, {formatDate(v.createdAt)}
            {v.validation.ok ? '' : ' (klarade inte kontrollen)'}
          </li>
        ))}
      </ol>
    </details>
  )
}

interface ProvenanceAsset {
  id: string
  alt: string
  generated: boolean
  license: AssetLicense
}

/** Item media plus choice media (multiple choice / multi select). */
const itemMedia = (it: Item): MediaRef[] => [
  ...it.media,
  ...('choices' in it ? it.choices.flatMap((c) => (c.media ? [c.media] : [])) : []),
]

function Provenance({ artifact }: { artifact: Artifact }) {
  const items = artifact.sections.flatMap((sec) => sec.items)
  const seen = new Map<string, { src: SourceRef; items: number[] }>()
  items.forEach((it, n) =>
    it.sources.forEach((src) => {
      const k = JSON.stringify(src.kind === 'upload' ? [src.studySetId, src.segmentId] : src)
      const e = seen.get(k) ?? { src, items: [] }
      e.items.push(n + 1)
      seen.set(k, e)
    }),
  )
  const all = [...seen.values()]
  const assetIds = [
    ...new Set(
      artifact.sections.flatMap((sec) => [...sec.media, ...sec.items.flatMap(itemMedia)]).map((m) => m.assetId),
    ),
  ]
  const prov = useResource<{ assets: ProvenanceAsset[] }>(
    assetIds.length ? `/research/provenance?assetIds=${assetIds.join(',')}` : null,
  )
  const which = (n: number[]) => (n.length === items.length ? 'alla uppgifter' : `uppgift ${n.join(', ')}`)
  const of = (kind: SourceRef['kind']) => all.filter((x) => x.src.kind === kind)

  return (
    <details className={s.card}>
      <summary>Källor och ursprung</summary>
      <div className={s.stack}>
        <p className={s.muted}>Källäge: {SOURCE_MODE[artifact.sourceMode].label}</p>
        {of('upload').length > 0 && (
          <div>
            <h4>Uppladdat material</h4>
            <ul className={s.plain}>
              {of('upload').map(({ src, items: n }, i) =>
                src.kind === 'upload' ? (
                  <li key={i}>
                    Sida {src.page}
                    {src.excerpt && ': '}
                    {src.excerpt && <q>{src.excerpt}</q>} <span className={s.muted}>({which(n)})</span>
                  </li>
                ) : null,
              )}
            </ul>
          </div>
        )}
        {of('web').length > 0 && (
          <div>
            <h4>Webbkällor</h4>
            <ul className={s.plain}>
              {of('web').map(({ src, items: n }, i) =>
                src.kind === 'web' ? (
                  <li key={i}>
                    <a href={src.url} target="_blank" rel="noreferrer">
                      {src.title}
                    </a>
                    {src.publisher && `, ${src.publisher}`} · hämtad {formatDate(src.retrievedAt)}{' '}
                    <span className={s.muted}>({which(n)})</span>
                  </li>
                ) : null,
              )}
            </ul>
          </div>
        )}
        {of('curriculum').length > 0 && (
          <div>
            <h4>Läroplanen (Skolverket)</h4>
            <ul className={s.plain}>
              {of('curriculum').map(({ src, items: n }, i) =>
                src.kind === 'curriculum' ? (
                  <li key={i}>
                    {src.ref.subjectCode}
                    {src.ref.span && `, ${src.ref.span}`}
                    {src.ref.itemId && `, ${src.ref.itemId}`} · version {src.ref.version}{' '}
                    <span className={s.muted}>({which(n)})</span>
                  </li>
                ) : null,
              )}
            </ul>
          </div>
        )}
        {of('model').length > 0 && (
          <p className={s.muted}>Skrivet av AI utan dokumentkälla: {which(of('model').flatMap((x) => x.items))}.</p>
        )}
        {prov.data && prov.data.assets.length > 0 && (
          <div>
            <h4>Bilder och licenser</h4>
            <ul className={s.plain}>
              {prov.data.assets.map((a) => (
                <li key={a.id}>
                  {a.alt}: {a.generated ? 'AI-genererad' : a.license.license}
                  {a.license.creator && `, ${a.license.creator}`}
                  {a.license.attribution && ` · ${a.license.attribution}`}
                  <ExtLink href={a.license.sourceUrl}>källa</ExtLink>
                  <ExtLink href={a.license.licenseUrl}>licens</ExtLink>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  )
}

interface Job {
  id: string
  more?: boolean
}

/** `/vuxen/elev/:id/material/:artifactId`: answers, checks, sources, approval, edits and reworks. */
const CONFLICT = 'Materialet har ändrats. Ladda om för att se den senaste versionen.'

export function ArtifactView() {
  const { learner } = useLearner()
  const { artifactId = '' } = useParams()
  const res = useResource<ArtifactResponse>(paths.artifact(artifactId))
  const [msg, setMsg] = useState('')
  const [job, setJob] = useState<Job>()
  const [done, setDone] = useState<JobStatus & { more?: boolean }>()
  const [theme, setTheme] = useState('')
  const [themeOpen, setThemeOpen] = useState(false)
  const reload = res.reload
  const onDone = useCallback(
    (st: JobStatus) => {
      setDone({ ...st, more: job?.more })
      setJob(undefined)
      reload()
    },
    [job, reload],
  )

  if (!res.data)
    return (
      <p role="status" className={s.muted}>
        {res.error ? res.error.message : 'Hämtar …'}
      </p>
    )
  const { artifact: a, requestedIllustrations } = res.data
  const issues = a.validation.issues
  const general = issues.filter((i) => !i.itemId)
  const flagged = issues.filter((i) => i.itemId && i.severity !== 'error')
  const busy = !!job

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setMsg('')
    try {
      await fn()
      if (ok) setMsg(ok)
      return true
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'version_conflict') {
        setMsg(CONFLICT)
        reload()
      } else setMsg(errorText(e))
      return false
    }
  }
  const approve = (kind: 'approve' | 'reject') =>
    act(
      async () => {
        const r = await adultApi.post<Artifact>(`/artifacts/${a.id}/${kind}`, { version: a.version })
        res.set({ ...res.data!, artifact: { ...a, approval: r.approval } })
      },
      kind === 'approve' ? 'Materialet är godkänt.' : 'Materialet är avvisat.',
    )
  const patch = (body: object, ok: string) =>
    act(async () => {
      const r = await adultApi.patch<Artifact>(`/artifacts/${a.id}`, { ...body, version: a.version })
      res.set({ ...res.data!, artifact: r })
    }, ok)
  const startJob = (path: string, body: unknown, more?: boolean) =>
    act(async () => {
      setDone(undefined)
      const r = await adultApi.post<{ jobId: string }>(path, body)
      setJob({ id: r.jobId, more })
    })
  const transform = (kind: string) => {
    if (kind === 'changeTheme' && !themeOpen) return setThemeOpen(true)
    void startJob(`/artifacts/${a.id}/transform`, kind === 'changeTheme' ? { kind, theme } : { kind }, kind === 'more')
    setThemeOpen(false)
  }

  let n = 0
  return (
    <article className={s.stack} aria-labelledby="art-h">
      <section className={s.card}>
        <div className={s.cardHead}>
          <h2 id="art-h">{a.title}</h2>
          <span className={`${s.badge} ${s[`ap_${a.approval}`] ?? ''}`}>{APPROVAL[a.approval]}</span>
        </div>
        <p className={s.muted}>
          {ARTIFACT_TYPE[a.type]} · version {a.version} · {formatDate(a.createdAt)} ·{' '}
          {a.feedback === 'end' ? 'återkoppling i slutet' : 'återkoppling direkt'}
        </p>
        {a.validation.ok ? (
          <p className={s.ok}>
            {flagged.length === 0 ? (
              'Materialet klarade kontrollen.'
            ) : (
              <>
                Klarade kontrollen ·{' '}
                <Button
                  variant="quiet"
                  onClick={() => document.getElementById(`item-${flagged[0]!.itemId}`)?.scrollIntoView()}
                >
                  {flagged.length === 1 ? '1 sak att titta på' : `${flagged.length} saker att titta på`}
                </Button>
              </>
            )}
          </p>
        ) : (
          <p className={s.issueError}>
            Materialet har {issues.filter((i) => i.severity === 'error').length} fel som behöver rättas innan det kan
            godkännas.
          </p>
        )}
        {general.map((i, k) => (
          <p key={k} className={i.severity === 'error' ? s.issueError : s.issueWarn}>
            {i.message}
          </p>
        ))}
        <div className={s.row}>
          <Button disabled={busy || !a.validation.ok || a.approval === 'approved'} onClick={() => approve('approve')}>
            Godkänn
          </Button>
          <Button variant="secondary" disabled={busy || a.approval === 'rejected'} onClick={() => approve('reject')}>
            Avvisa
          </Button>
        </div>
        <p role="status" className={s.msg}>
          {msg}
        </p>
      </section>

      <section className={s.card} aria-labelledby="tr-h">
        <h3 id="tr-h">Gör om materialet</h3>
        <div className={s.row}>
          {TRANSFORMS.map(([k, label]) => (
            <Button key={k} variant="secondary" disabled={busy} onClick={() => transform(k)}>
              {label}
            </Button>
          ))}
        </div>
        {themeOpen && (
          <div className={s.row}>
            <label htmlFor="new-theme">Nytt tema</label>
            <input id="new-theme" value={theme} maxLength={100} onChange={(e) => setTheme(e.target.value)} />
            <Button disabled={!theme.trim()} onClick={() => transform('changeTheme')}>
              Byt tema
            </Button>
          </div>
        )}
        {job && <JobProgress key={job.id} jobId={job.id} onDone={onDone} />}
        {done?.state === 'failed' && <p className={s.msg}>{done.error?.adultMessage}</p>}
        {done?.state === 'completed' && done.more && done.resultId && (
          <p>
            <Link to={`/vuxen/elev/${learner.id}/material/${done.resultId}`}>Öppna det nya materialet</Link>
          </p>
        )}
        {done?.state === 'completed' && !done.more && <p className={s.ok}>Klart. En ny version visas nedan.</p>}
      </section>

      {a.sections.map((sec, si) => (
        <section key={si} className={s.card} aria-label={sec.title ?? `Del ${si + 1}`}>
          {sec.title && <h3>{sec.title}</h3>}
          {sec.body && <p className={s.body}>{sec.body}</p>}
          {sec.items.length > 0 && (
            <ol className={s.items}>
              {sec.items.map((it) => (
                <ItemView
                  key={`${it.id}-${a.version}`}
                  item={it}
                  n={++n}
                  busy={busy}
                  issues={issues.filter((i) => i.itemId === it.id)}
                  illustration={requestedIllustrations.find((r) => r.itemId === it.id)?.description}
                  onEdit={(p) => patch({ items: { [it.id]: p } }, 'Ändringen är sparad som en ny version.')}
                  onRemove={() => void patch({ removeItems: [it.id] }, 'Uppgiften är borttagen.')}
                  onRegenerate={() => void startJob(`/artifacts/${a.id}/items/${it.id}/regenerate`, {})}
                />
              ))}
            </ol>
          )}
        </section>
      ))}

      <Provenance artifact={a} />
      <Versions id={a.id} current={a.version} />
    </article>
  )
}
