import { useEffect, useRef, useState, type DragEvent } from 'react'
import { API_PREFIX, type StudySet, type SystemStatus } from '../../../shared/contracts'
import { api, ApiRequestError } from '../../api/client'
import { Button } from '../../ui/Button'
import type { CommonProps } from '../runs/presentation'
import { checkFiles, MB, type Limits } from './checkFiles'
import { JobProgress } from './JobProgress'
import styles from './study.module.css'

// Upload study material (docs/platform/uploads.md). Pages are ordered here, before upload, because
// processing starts as soon as the server has the files.

export interface StudyUploadProps extends CommonProps {
  /** The set was accepted and processing started. */
  onUploaded?: (set: StudySet) => void
  /** Processing finished; the material is ready. */
  onReady?: (setId: string) => void
}

interface Page {
  key: string
  file: File
  url?: string
}

/** XHR (not fetch) for upload progress. Resolves with the parsed 201 body, rejects with ApiRequestError. */
function uploadXhr(url: string, form: FormData, onProgress: (f: number) => void) {
  return new Promise<{ set: StudySet; jobId: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.withCredentials = true
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total)
    xhr.onload = () => {
      let body: { set: StudySet; jobId: string; error?: { code: string; message: string } } | undefined
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        body = undefined
      }
      if (xhr.status >= 200 && xhr.status < 300 && body) resolve(body)
      else
        reject(
          new ApiRequestError(
            xhr.status,
            body?.error?.code ?? 'error',
            body?.error?.message ?? 'Uppladdningen gick inte. Försök igen.',
          ),
        )
    }
    xhr.onerror = () => reject(new ApiRequestError(0, 'network', 'Ingen kontakt med servern. Försök igen.'))
    xhr.send(form)
  })
}

let seq = 0
const size = (b: number) => (b < MB ? `${Math.max(1, Math.round(b / 1024))} kB` : `${(b / MB).toFixed(1)} MB`)

export function StudyUpload({ learnerId, variant, onUploaded, onReady }: StudyUploadProps) {
  const [limits, setLimits] = useState<Limits>()
  const [pages, setPages] = useState<Page[]>([])
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState<string[]>([])
  const [progress, setProgress] = useState<number>()
  const [job, setJob] = useState<{ setId: string; jobId: string }>()
  const [ready, setReady] = useState(false)
  const [said, setSaid] = useState('')
  const [dragging, setDragging] = useState(false)
  const blocking = checkFiles(
    pages.map((p) => p.file),
    limits,
  )
  const pagesRef = useRef(pages)
  useEffect(() => {
    pagesRef.current = pages
  }, [pages])

  useEffect(() => {
    api
      .get<SystemStatus>('/system/status')
      .then((s) => setLimits(s.limits))
      .catch(() => undefined)
  }, [])
  // Free thumbnails when leaving.
  useEffect(() => () => pagesRef.current.forEach((p) => p.url && URL.revokeObjectURL(p.url)), [])

  const add = (list: FileList | File[] | null) => {
    const files = [...(list ?? [])]
    if (!files.length) return
    const ok = files.filter((f) => !checkFiles([f]).length)
    const next = [
      ...pages,
      ...ok.map((file) => ({
        key: `p${++seq}`,
        file,
        url: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      })),
    ]
    setPages(next)
    setNotes(checkFiles(files.filter((f) => !ok.includes(f))))
    setSaid(`${ok.length} ${ok.length === 1 ? 'fil tillagd' : 'filer tillagda'}. ${next.length} totalt.`)
  }

  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= pages.length) return
    const next = [...pages]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    setPages(next)
    setSaid(`${pages[i]!.file.name} är nu sida ${j + 1} av ${pages.length}.`)
  }

  const remove = (i: number) => {
    const p = pages[i]!
    if (p.url) URL.revokeObjectURL(p.url)
    const next = pages.filter((_, k) => k !== i)
    setPages(next)
    setNotes([])
    setSaid(`${p.file.name} borttagen.`)
  }

  const submit = async () => {
    if (blocking.length || !pages.length) return
    const form = new FormData()
    if (title.trim()) form.append('title', title.trim())
    for (const p of pages) form.append('files', p.file, p.file.name)
    setProgress(0)
    try {
      const res = await uploadXhr(`${API_PREFIX}/learners/${learnerId}/study-sets`, form, setProgress)
      setJob({ setId: res.set.id, jobId: res.jobId })
      onUploaded?.(res.set)
    } catch (e) {
      setNotes([(e as Error).message])
      setProgress(undefined)
    }
  }

  const retry = async () => {
    if (!job) return
    try {
      const res = await api.post<{ set: StudySet; jobId: string }>(
        `/learners/${learnerId}/study-sets/${job.setId}/reprocess`,
      )
      setJob({ setId: res.set.id, jobId: res.jobId })
    } catch (e) {
      setNotes([(e as Error).message])
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    add(e.dataTransfer.files)
  }

  if (job)
    return (
      <section className={styles.panel} data-variant={variant} aria-labelledby="upload-heading">
        <h2 id="upload-heading">{title.trim() || 'Studiematerial'}</h2>
        {ready ? (
          <p className={styles.okBox} role="status">
            Materialet är klart. Originalbilderna har tagits bort efter bearbetning.
          </p>
        ) : (
          <JobProgress
            key={job.jobId}
            jobId={job.jobId}
            variant={variant}
            label="Materialet väntar på att läsas"
            onCompleted={() => {
              setReady(true)
              onReady?.(job.setId)
            }}
            onRetry={variant === 'adult' ? () => void retry() : undefined}
          />
        )}
        {notes.map((e) => (
          <p key={e} className={styles.calmBox}>
            {e}
          </p>
        ))}
      </section>
    )

  const uploading = progress !== undefined
  const errors = [...blocking, ...notes]
  return (
    <section className={styles.panel} data-variant={variant} aria-labelledby="upload-heading">
      <h2 id="upload-heading">Ladda upp studiematerial</h2>
      <p className={styles.note}>
        Fotografera sidorna eller välj bilder och PDF-filer. Sidorna läses i den ordning de står här.
        {limits &&
          ` Högst ${limits.maxPagesPerSet} sidor, ${limits.maxUploadFileMb} MB per fil och ${limits.maxUploadTotalMb} MB totalt.`}
      </p>

      <label className={styles.field}>
        <span>Titel (valfri)</span>
        <input
          value={title}
          maxLength={200}
          placeholder="Till exempel: Fotosyntes, kapitel 3"
          onChange={(e) => setTitle(e.target.value)}
          disabled={uploading}
        />
      </label>

      <div
        className={[styles.drop, dragging && styles.dragging].filter(Boolean).join(' ')}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <p>Släpp filer här, eller:</p>
        <div className={styles.pickers}>
          <label className={styles.picker}>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="visually-hidden"
              disabled={uploading}
              onChange={(e) => {
                add(e.target.files)
                e.target.value = ''
              }}
            />
            Ta foto
          </label>
          <label className={styles.picker}>
            <input
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="visually-hidden"
              disabled={uploading}
              onChange={(e) => {
                add(e.target.files)
                e.target.value = ''
              }}
            />
            Välj filer
          </label>
        </div>
      </div>

      {pages.length > 0 && (
        <ol className={styles.pages} aria-label="Sidor i ordning">
          {pages.map((p, i) => (
            <li key={p.key} className={styles.pageRow}>
              <span className={styles.pageNo}>Sida {i + 1}</span>
              {p.url ? (
                <img src={p.url} alt="" className={styles.thumb} />
              ) : (
                <span className={styles.thumb} aria-hidden="true">
                  PDF
                </span>
              )}
              <span className={styles.fileName}>
                {p.file.name}
                <span className={styles.note}> · {size(p.file.size)}</span>
              </span>
              <span className={styles.rowButtons}>
                <button
                  type="button"
                  className={styles.small}
                  aria-label={`Flytta upp ${p.file.name}`}
                  disabled={uploading || i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={styles.small}
                  aria-label={`Flytta ner ${p.file.name}`}
                  disabled={uploading || i === pages.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={styles.small}
                  aria-label={`Ta bort ${p.file.name}`}
                  disabled={uploading}
                  onClick={() => remove(i)}
                >
                  Ta bort
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="visually-hidden" aria-live="polite">
        {said}
      </p>

      {errors.length > 0 && (
        <ul className={styles.calmBox} role="status">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      {uploading ? (
        <div className={styles.job}>
          <p role="status">Laddar upp … {Math.round(progress * 100)} %</p>
          <progress max={1} value={progress} aria-label="Uppladdning" />
        </div>
      ) : (
        <div className={styles.actions}>
          <Button disabled={!pages.length || blocking.length > 0} onClick={() => void submit()}>
            Ladda upp {pages.length > 0 && `${pages.length} ${pages.length === 1 ? 'sida' : 'sidor'}`}
          </Button>
        </div>
      )}
    </section>
  )
}
