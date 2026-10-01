import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasFel, mockApi } from '../runs/testApi'
import { checkFiles } from './checkFiles'
import { StudySetView } from './StudySetView'
import { StudyUpload } from './StudyUpload'
import { TestConfigurator } from './TestConfigurator'

const L = 'l1'
const limits = { maxUploadFileMb: 1, maxUploadTotalMb: 2, maxPagesPerSet: 3 }
const status = { ready: true, capabilities: [], features: {}, limits }
const file = (name: string, type: string, bytes = 10) => new File([new Uint8Array(bytes)], name, { type })

/** Fake XHR: records the form, reports progress, answers 201. */
class FakeXhr {
  static last?: FakeXhr
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {}
  onload?: () => void
  onerror?: () => void
  status = 0
  responseText = ''
  withCredentials = false
  url = ''
  form?: FormData
  open(_m: string, url: string) {
    this.url = url
  }
  send(form: FormData) {
    this.form = form
    FakeXhr.last = this
  }
  respond(status: number, body: unknown) {
    this.status = status
    this.responseText = JSON.stringify(body)
    this.onload?.()
  }
}

beforeEach(() => {
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => vi.unstubAllGlobals())

describe('checkFiles', () => {
  it('mirrors the server limits and types', () => {
    expect(checkFiles([file('a.jpg', 'image/jpeg')], limits)).toEqual([])
    expect(checkFiles([file('a.heic', 'image/heic')])[0]).toMatch(/HEIC/)
    expect(checkFiles([file('a.txt', 'text/plain')])[0]).toMatch(/inte en bild/)
    expect(checkFiles([file('big.png', 'image/png', 1.5 * 1024 * 1024)], limits)[0]).toMatch(/större än 1 MB/)
    const four = ['1', '2', '3', '4'].map((n) => file(`${n}.png`, 'image/png'))
    expect(checkFiles(four, limits)).toContain('Materialet har fler än 3 sidor.')
  })
})

describe('StudyUpload', () => {
  it('validates, reorders by keyboard, uploads with progress and follows the job', async () => {
    mockApi({
      'GET /system/status': status,
      'GET /jobs/j1': {
        id: 'j1',
        type: 'study.process',
        state: 'processing',
        progress: 0.25,
        step: 'Läser sida 3 av 12',
        attempts: 1,
      },
    })
    const onUploaded = vi.fn()
    render(<StudyUpload learnerId={L} variant="adult" onUploaded={onUploaded} />)
    expect(await screen.findByText(/Högst 3 sidor/)).toBeInTheDocument()

    const input = document.querySelector('input[type=file][multiple]') as HTMLInputElement
    await userEvent.upload(
      input,
      [file('ett.png', 'image/png'), file('tva.pdf', 'application/pdf'), file('bild.heic', 'image/heic')],
      {
        applyAccept: false,
      },
    )
    expect(screen.getByText(/HEIC-bild/)).toBeInTheDocument()
    const pages = within(screen.getByRole('list', { name: 'Sidor i ordning' }))
    expect(pages.getAllByRole('listitem')).toHaveLength(2)

    screen.getByRole('button', { name: 'Flytta ner ett.png' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(pages.getAllByRole('listitem')[0]).toHaveTextContent('tva.pdf')
    expect(screen.getByText('ett.png är nu sida 2 av 2.')).toBeInTheDocument()

    // A too-big file blocks the upload until it is removed.
    await userEvent.upload(input, file('stor.jpg', 'image/jpeg', 1.5 * 1024 * 1024))
    expect(screen.getByText(/större än 1 MB/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Ladda upp/ })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Ta bort stor.jpg' }))

    await userEvent.type(screen.getByLabelText('Titel (valfri)'), 'Kapitel 3')
    await userEvent.click(screen.getByRole('button', { name: 'Ladda upp 2 sidor' }))
    const xhr = FakeXhr.last!
    expect(xhr.url).toBe(`/api/v1/learners/${L}/study-sets`)
    expect(xhr.form!.getAll('files').map((f) => (f as File).name)).toEqual(['tva.pdf', 'ett.png'])
    expect(xhr.form!.get('title')).toBe('Kapitel 3')
    xhr.upload.onprogress!({ lengthComputable: true, loaded: 50, total: 100 })
    expect(await screen.findByText('Laddar upp … 50 %')).toBeInTheDocument()

    xhr.respond(201, { set: { id: 's1', title: 'Kapitel 3', status: 'queued', pages: [] }, jobId: 'j1' })
    expect(await screen.findByText('Läser sida 3 av 12 …')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0.25')
    expect(onUploaded).toHaveBeenCalled()
  })

  it('shows the server message (Swedish) when the upload is refused', async () => {
    mockApi({ 'GET /system/status': status })
    render(<StudyUpload learnerId={L} variant="adult" />)
    const input = document.querySelector('input[type=file][multiple]') as HTMLInputElement
    await userEvent.upload(input, file('a.png', 'image/png'))
    await userEvent.click(screen.getByRole('button', { name: /Ladda upp/ }))
    FakeXhr.last!.respond(400, {
      error: { code: 'unsupported_type', message: '”a.png” är inte en bild (JPEG, PNG, WEBP) eller en PDF.' },
    })
    expect(await screen.findByText('”a.png” är inte en bild (JPEG, PNG, WEBP) eller en PDF.')).toBeInTheDocument()
  })
})

describe('StudySetView', () => {
  const set = {
    id: 's1',
    learnerId: L,
    title: 'Glosor',
    status: 'ready',
    createdAt: '',
    pages: [{ page: 1, mimeType: 'image/jpeg', bytes: 1, sourceDeleted: true }],
  }
  const material = {
    studySetId: 's1',
    language: 'en',
    topic: 'Djur',
    summary: 'Ord om djur.',
    concepts: ['djur'],
    curriculumRefs: [],
    processedAt: '2026-10-01T10:00:00Z',
    segments: [
      {
        id: 'p1s1',
        page: 1,
        kind: 'vocabulary',
        text: 'Glosor',
        data: { pairs: [{ term: 'dog', translation: 'hund' }] },
        confidence: 'high',
      },
      { id: 'p1s2', page: 1, kind: 'formula', text: 'a + b = c', data: { latex: 'a+b=c' }, confidence: 'high' },
    ],
  }

  it('shows material, vocabulary table, deletion note and adult provenance', async () => {
    mockApi({
      'GET /learners/l1/study-sets/s1': { set, jobId: 'j0' },
      'GET /learners/l1/study-sets/s1/material': {
        ...material,
        provenance: { method: 'vision', pages: 1, cachedPages: 0 },
      },
    })
    render(<StudySetView learnerId={L} variant="adult" setId="s1" />)
    expect(await screen.findByRole('cell', { name: 'hund' })).toBeInTheDocument()
    expect(screen.getByText('a+b=c')).toBeInTheDocument()
    expect(screen.getByText('Originalbilderna har tagits bort efter bearbetning.')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Ursprung' })).toBeInTheDocument()
  })

  it('hides provenance from learners', async () => {
    mockApi({ 'GET /learners/l1/study-sets/s1': { set }, 'GET /learners/l1/study-sets/s1/material': material })
    render(<StudySetView learnerId={L} variant="upper" setId="s1" />)
    expect(await screen.findByText('Djur')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Ursprung' })).toBeNull()
  })
})

describe('TestConfigurator', () => {
  it('sends a practiceTest request and explains a pending approval kindly', async () => {
    const calls = mockApi({
      [`POST /learners/${L}/generate`]: { jobId: 'g1' },
      'GET /jobs/g1': {
        id: 'g1',
        type: 'artifact.generate',
        state: 'completed',
        progress: 1,
        attempts: 1,
        resultId: 'a1',
      },
      // Learners get 404 until an adult approves.
    })
    const onCreated = vi.fn()
    render(<TestConfigurator learnerId={L} variant="middle" studySetId="s1" onCreated={onCreated} />)
    expect(screen.getByLabelText(/Låt AI välja en bra blandning/)).toBeChecked()
    await userEvent.click(screen.getByLabelText(/Materialet \+ läroplanen/))
    await userEvent.click(screen.getByLabelText('När provet är klart'))
    await userEvent.click(screen.getByRole('button', { name: 'Skapa provet' }))
    expect(await screen.findByText(/En vuxen tittar på provet först/)).toBeInTheDocument()
    expect(onCreated).toHaveBeenCalledWith('a1', 'pendingApproval')
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      type: 'practiceTest',
      studySetId: 's1',
      sourceMode: 'sourceAndCurriculum',
      questionCount: 10,
      feedback: 'end',
      hints: true,
    })
    expect(hasFel()).toBe(false)
  })

  it('sends chosen item kinds', async () => {
    const calls = mockApi({ [`POST /learners/${L}/generate`]: { jobId: 'g1' } })
    render(<TestConfigurator learnerId={L} variant="adult" studySetId="s1" onCreated={vi.fn()} />)
    await userEvent.click(screen.getByLabelText('Välj själv'))
    await userEvent.click(screen.getByLabelText('Para ihop'))
    await userEvent.click(screen.getByRole('button', { name: 'Skapa provet' }))
    expect((calls.find((c) => c.method === 'POST')!.body as { itemKinds: string[] }).itemKinds).toEqual([
      'multipleChoice',
      'trueFalse',
      'fillBlank',
      'matching',
    ])
  })
})
