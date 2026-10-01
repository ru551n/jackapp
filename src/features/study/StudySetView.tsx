import { useCallback, useEffect, useState } from 'react'
import type { ProcessedStudyMaterial, StudySegment, StudySet } from '../../../shared/contracts'
import { api } from '../../api/client'
import { Button } from '../../ui/Button'
import { errorText, STATUS_LABEL, type CommonProps } from '../runs/presentation'
import { JobProgress } from './JobProgress'
import styles from './study.module.css'

export interface StudySetViewProps extends CommonProps {
  setId: string
  /** "Skapa övningsprov" for a ready set. */
  onConfigure?: (setId: string) => void
}

interface Provenance {
  method: 'vision' | 'text-layer'
  pages: number
  cachedPages: number
}
type Material = ProcessedStudyMaterial & { provenance?: Provenance }

const KIND_LABEL: Partial<Record<StudySegment['kind'], string>> = {
  definition: 'Definition',
  vocabulary: 'Glosor',
  formula: 'Formel',
  example: 'Exempel',
  question: 'Fråga',
  table: 'Tabell',
  diagram: 'Diagram',
  map: 'Karta',
  image: 'Bild',
  handwriting: 'Handskrivet',
}

const strings = (x: unknown): string[] => (Array.isArray(x) ? x.map((c) => String(c ?? '')) : [])

function Segment({ s, adult }: { s: StudySegment; adult: boolean }) {
  const pairs = Array.isArray(s.data?.pairs) ? (s.data.pairs as { term?: unknown; translation?: unknown }[]) : []
  const rows = Array.isArray(s.data?.rows) ? (s.data.rows as unknown[]).map(strings) : []
  const latex = typeof s.data?.latex === 'string' ? s.data.latex : undefined
  const label = KIND_LABEL[s.kind]
  let body
  if (s.kind === 'heading') body = <h4>{s.text}</h4>
  else if (s.kind === 'vocabulary' && pairs.length)
    body = (
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Ord</th>
            <th scope="col">Översättning</th>
          </tr>
        </thead>
        <tbody>
          {pairs.map((p, i) => (
            <tr key={i}>
              <td>{String(p.term ?? '')}</td>
              <td>{String(p.translation ?? '')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  else if (s.kind === 'table' && rows.length)
    body = (
      <table className={styles.table}>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => (i === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}</tr>
          ))}
        </tbody>
      </table>
    )
  else if (s.kind === 'formula')
    body = (
      <p className={styles.formula}>
        {s.text}
        {latex && latex !== s.text && <code className={styles.latex}>{latex}</code>}
      </p>
    )
  else body = <p className={styles.segText}>{s.text}</p>
  return (
    <div className={styles.segment} data-kind={s.kind}>
      {label && <span className={styles.kind}>{label}</span>}
      {body}
      {adult && s.confidence === 'low' && <span className={styles.note}>Osäker läsning – kontrollera mot boken.</span>}
    </div>
  )
}

export function StudySetView({ learnerId, variant, setId, onConfigure }: StudySetViewProps) {
  const [set, setSet] = useState<StudySet>()
  const [jobId, setJobId] = useState<string>()
  const [material, setMaterial] = useState<Material>()
  const [error, setError] = useState('')
  const adult = variant === 'adult'
  const base = `/learners/${learnerId}/study-sets/${setId}`

  const load = useCallback(
    () =>
      api
        .get<{ set: StudySet; jobId?: string }>(base)
        .then(async (r) => {
          const m = r.set.status === 'ready' ? await api.get<Material>(`${base}/material`) : undefined
          setSet(r.set)
          setJobId(r.jobId)
          setMaterial(m)
        })
        .catch((e) => setError(errorText(variant, e, 'Materialet gick inte att hämta just nu.'))),
    [base, variant],
  )
  useEffect(() => {
    void load()
  }, [load])

  const reprocess = async () => {
    try {
      const r = await api.post<{ set: StudySet; jobId: string }>(`${base}/reprocess`)
      setSet(r.set)
      setJobId(r.jobId)
    } catch (e) {
      setError(errorText(variant, e, 'Det gick inte just nu.'))
    }
  }

  if (error && !set) return <p className={styles.note}>{error}</p>
  if (!set) return <p className={styles.note}>Hämtar material …</p>

  const byPage = new Map<number, StudySegment[]>()
  for (const s of material?.segments ?? []) byPage.set(s.page, [...(byPage.get(s.page) ?? []), s])
  const deleted = set.pages.length > 0 && set.pages.every((p) => p.sourceDeleted)

  return (
    <article className={styles.panel} data-variant={variant} aria-labelledby="set-heading">
      <header className={styles.setHeader}>
        <h2 id="set-heading">{set.title}</h2>
        <span className={styles.status} data-status={set.status}>
          {STATUS_LABEL[set.status]}
        </span>
      </header>

      {set.status !== 'ready' && set.status !== 'failed' && jobId && (
        <JobProgress
          jobId={jobId}
          variant={variant}
          label="Materialet väntar på att läsas"
          onCompleted={() => void load()}
        />
      )}
      {set.status === 'failed' && (
        <div className={styles.calmBox}>
          <p>
            {adult
              ? (set.failure ?? 'Materialet kunde inte läsas.')
              : 'Materialet kunde inte läsas. Be en vuxen titta på det.'}
          </p>
          {adult && (
            <Button variant="secondary" onClick={() => void reprocess()}>
              Försök igen
            </Button>
          )}
        </div>
      )}
      {error && <p className={styles.note}>{error}</p>}

      {material && (
        <>
          <section className={styles.overview} aria-label="Översikt">
            <p className={styles.kind}>Ämnesområde</p>
            <h3>{material.topic}</h3>
            <p>{material.summary}</p>
            {material.concepts.length > 0 && (
              <ul className={styles.chips} aria-label="Viktiga begrepp">
                {material.concepts.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
          </section>

          {[...byPage].map(([page, segs]) => (
            <section key={page} className={styles.page} aria-label={`Sida ${page}`}>
              <h3 className={styles.pageHead}>Sida {page}</h3>
              {segs.map((s) => (
                <Segment key={s.id} s={s} adult={adult} />
              ))}
            </section>
          ))}

          {deleted && <p className={styles.note}>Originalbilderna har tagits bort efter bearbetning.</p>}

          {adult && material.provenance && (
            <section className={styles.provenance} aria-label="Ursprung">
              <h3>Ursprung</h3>
              <ul>
                <li>
                  Läst med{' '}
                  {material.provenance.method === 'vision'
                    ? 'AI-bildtolkning'
                    : 'PDF-filens textlager (ingen bildtolkning)'}
                </li>
                <li>
                  {material.provenance.pages} sidor
                  {material.provenance.cachedPages > 0 &&
                    `, varav ${material.provenance.cachedPages} återanvända från en tidigare läsning`}
                </li>
                <li>Bearbetat {new Date(material.processedAt).toLocaleString('sv-SE')}</li>
                {material.curriculumRefs.length > 0 && (
                  <li>Kopplat till {material.curriculumRefs.length} delar av läroplanen</li>
                )}
              </ul>
            </section>
          )}

          {onConfigure && (
            <div className={styles.actions}>
              <Button icon="arrow" onClick={() => onConfigure(set.id)}>
                Skapa övningsprov
              </Button>
            </div>
          )}
        </>
      )}
    </article>
  )
}
