import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SupportPreferences, type SchoolPosition } from '../../../shared/contracts'
import { defaultState, LEGACY_KEY, learnerKey } from '../../store/state'
import { getState } from '../../store/store'
import { bandOf, CALM_FAILURE, type LearnerView } from './api'
import { LearnerArea } from './index'
import { presentationFlags, usePresentation } from './presentation'

const ID = '00000000-0000-4000-8000-000000000001'

function learner(school: SchoolPosition, extra: Partial<LearnerView> = {}): LearnerView {
  return {
    id: ID,
    displayName: 'Jack',
    school,
    language: 'sv',
    presentation: { ...SupportPreferences.parse({}), ageBand: bandOf({ school }), school },
    learnerRequestsAllowed: true,
    ...extra,
  }
}
const EARLY = { stage: 'grundskola', year: 1 } as const
const MIDDLE = { stage: 'grundskola', year: 5 } as const
const UPPER = { stage: 'gymnasieskola', year: 2 } as const

type Reply = [number, unknown] | ((body: unknown) => [number, unknown])
/** Stubs fetch: keys are "METHOD /path" (after /api/v1, without query); unknown GETs return []. */
function mockApi(routes: Record<string, Reply>) {
  const calls: { key: string; body: unknown }[] = []
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace('/api/v1', '')
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ key: `${method} ${path}`, body })
    const hit = Object.entries(routes).find(([k]) => `${method} ${path.split('?')[0]}` === k)
    const reply = hit ? hit[1] : method === 'GET' ? ([200, []] as [number, unknown]) : ([404, {}] as [number, unknown])
    const [status, data] = typeof reply === 'function' ? reply(body) : reply
    return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

function renderAt(path = `/l/${ID}`) {
  const router = createMemoryRouter(
    [
      { path: '/l/:learnerId/*', element: <LearnerArea /> },
      { path: '/', element: <div>Vem ska lära sig?</div> },
    ],
    { initialEntries: [path] },
  )
  render(<RouterProvider router={router} />)
  return router
}

const job = (state: string, extra: object = {}) => ({
  id: 'j1',
  type: 'artifact.generate',
  state,
  progress: state === 'completed' ? 1 : 0.4,
  attempts: 1,
  createdAt: '',
  updatedAt: '',
  ...extra,
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete document.documentElement.dataset.band
  delete document.documentElement.dataset.motion
})

describe('band selection', () => {
  it('derives the band from the school position when the view has none', () => {
    expect(bandOf({ school: { stage: 'forskoleklass', year: 0 } })).toBe('early')
    expect(bandOf({ school: EARLY })).toBe('early')
    expect(bandOf({ school: MIDDLE })).toBe('middle')
    expect(bandOf({ school: UPPER })).toBe('upper')
    expect(bandOf({ school: EARLY, ageBand: 'middle' })).toBe('middle')
  })

  it('early learners get the JackApp home, with an exit to the picker', async () => {
    mockApi({ [`GET /learners/${ID}`]: [200, learner(EARLY)] })
    renderAt()
    expect(await screen.findByRole('heading', { name: 'Mitt äventyr' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Tunnelbanan/ })).toHaveAttribute('href', `/l/${ID}/omrade/tunnelbanan`)
    expect(screen.getByRole('link', { name: 'Byt elev' })).toHaveAttribute('href', '/')
    expect(screen.queryByRole('link', { name: 'För vuxna' })).not.toBeInTheDocument()
    expect(document.documentElement.dataset.band).toBe('early')
  })

  it('middle learners get the denser home with "Idag" and subjects', async () => {
    mockApi({
      [`GET /learners/${ID}/next`]: [200, [{ kind: 'explore', title: 'Bråk', text: 'Prova något nytt.' }]],
      [`GET /learners/${ID}`]: [200, learner(MIDDLE)],
      'GET /curriculum/subjects': [200, { subjects: [{ code: 'GRGRMAT01', name: 'Matematik' }] }],
    })
    renderAt()
    expect(await screen.findByRole('heading', { name: 'Hej Jack!' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Idag' })).toBeInTheDocument()
    expect(await screen.findByText('Bråk')).toBeInTheDocument()
    expect(await screen.findByText('Alla ämnen i årskurs 5')).toBeInTheDocument()
    expect(screen.getByText('Matematik')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Byt elev' })).toHaveAttribute('href', '/')
    expect(screen.queryByText('Mitt äventyr')).not.toBeInTheDocument()
  })

  it('upper learners get the study dashboard', async () => {
    mockApi({ [`GET /learners/${ID}`]: [200, learner(UPPER)], 'GET /curriculum/subjects': [200, { subjects: [] }] })
    renderAt()
    expect(await screen.findByRole('heading', { name: 'Översikt' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Skapa övningsprov' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Studieplaner' })).toBeInTheDocument()
    expect(screen.getByText(/Be en vuxen ladda upp/)).toBeInTheDocument()
  })

  it('an unknown learner gets a calm way back', async () => {
    mockApi({ [`GET /learners/${ID}`]: [404, { error: { code: 'not_found', message: 'x' } }] })
    renderAt()
    expect(await screen.findByText('Den här eleven finns inte här.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Byt elev' })).toBeInTheDocument()
  })
})

describe('usePresentation', () => {
  const p = (over: Partial<SupportPreferences> = {}) => ({
    ...SupportPreferences.parse(over),
    ageBand: 'early' as const,
    school: EARLY,
  })

  it('maps support preferences to variables, attributes and flags', () => {
    const f = presentationFlags(p({ visualSupport: 'high', textAmount: 'minimal', maxChoices: 3, stepByStep: true }))
    expect(f).toMatchObject({ band: 'early', maxChoices: 3, stepByStep: true, readAloud: true, sound: false })
    expect(f.rootProps).toMatchObject({ 'data-band': 'early', 'data-text': 'minimal', 'data-visual': 'high' })
    expect(f.rootProps.style).toMatchObject({ '--visual-scale': '1.25' })
    expect(presentationFlags(p({ reducedVisualComplexity: true })).rootProps.style).toMatchObject({
      '--shadow': 'none',
    })
  })

  it('mirrors band and reduced motion onto <html> and restores on unmount', () => {
    document.documentElement.dataset.motion = 'full'
    const { unmount } = renderHook(() => usePresentation(p({ reducedMotion: true })))
    expect(document.documentElement.dataset).toMatchObject({ band: 'early', motion: 'reduced' })
    unmount()
    expect(document.documentElement.dataset.band).toBeUndefined()
    expect(document.documentElement.dataset.motion).toBe('full')
  })

  it('applies server support preferences to the early-years settings', async () => {
    const view = learner(EARLY)
    view.presentation = { ...view.presentation, readAloud: false, sound: true, reducedMotion: true }
    mockApi({ [`GET /learners/${ID}`]: [200, view] })
    renderAt()
    await screen.findByRole('heading', { name: 'Mitt äventyr' })
    expect(getState().settings).toMatchObject({ speech: false, sound: true, motion: 'reduced' })
    expect(JSON.parse(localStorage.getItem(learnerKey(ID))!).settings.speech).toBe(false)
  })
})

describe('legacy progress', () => {
  const legacy = () => {
    const s = defaultState()
    s.missions.flygplatsen = 2
    return JSON.stringify(s)
  }

  it('asks once, moves it to the learner and keeps the old copy', async () => {
    const raw = legacy()
    localStorage.setItem(LEGACY_KEY, raw)
    mockApi({ [`GET /learners/${ID}`]: [200, learner(EARLY)] })
    renderAt()
    expect(await screen.findByText(/2 uppdrag/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ja, flytta till Jack' }))
    expect(await screen.findByRole('heading', { name: 'Mitt äventyr' })).toBeInTheDocument()
    expect(getState().missions.flygplatsen).toBe(2)
    expect(localStorage.getItem(LEGACY_KEY)).toBe(raw)
  })

  it('is not offered to middle or upper learners', async () => {
    localStorage.setItem(LEGACY_KEY, legacy())
    mockApi({ [`GET /learners/${ID}`]: [200, learner(MIDDLE)] })
    renderAt()
    expect(await screen.findByRole('heading', { name: 'Hej Jack!' })).toBeInTheDocument()
    expect(screen.queryByText(/tidigare JackApp/)).not.toBeInTheDocument()
  })
})

describe('guided request (early)', () => {
  const start = async (artifact: Reply) => {
    const calls = mockApi({
      [`GET /learners/${ID}`]: [200, learner(EARLY)],
      [`POST /learners/${ID}/generate`]: [202, { jobId: 'j1' }],
      'GET /jobs/j1': [200, job('completed', { resultId: 'a1' })],
      'GET /artifacts/a1': artifact,
    })
    renderAt(`/l/${ID}/onska`)
    expect(await screen.findByRole('heading', { name: 'Vad vill du öva på?' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Räkna' }))
    expect(screen.getByRole('heading', { name: 'Vilket tema?' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tåg' }))
    await userEvent.click(screen.getByRole('button', { name: 'Skapa uppdrag' }))
    return calls
  }

  it('posts picture choices only, then waits for an adult', async () => {
    const calls = await start([404, { error: { code: 'not_found', message: 'x' } }])
    expect(await screen.findByText('En vuxen tittar på uppdraget först.')).toBeInTheDocument()
    const post = calls.find((c) => c.key.startsWith('POST'))!
    expect(post.body).toEqual({ type: 'exercises', subjectCode: 'GRGRMAT01', theme: 'Tåg' })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('offers to start approved material', async () => {
    await start([200, { artifact: { id: 'a1', title: 'Räkna med tåg' } }])
    expect(await screen.findByText('Ditt uppdrag är klart!')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Starta' })).toHaveAttribute('href', `/l/${ID}/material/a1`)
  })

  it('respects max choices with a "Fler val" page', async () => {
    const view = learner(EARLY)
    view.presentation.maxChoices = 2
    mockApi({ [`GET /learners/${ID}`]: [200, view] })
    renderAt(`/l/${ID}/onska`)
    await screen.findByRole('heading', { name: 'Vad vill du öva på?' })
    expect(screen.queryByRole('button', { name: 'Engelska' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Fler val' }))
    expect(screen.getByRole('button', { name: 'Engelska' })).toBeInTheDocument()
  })

  it('tells the learner to ask an adult when requests are off', async () => {
    mockApi({ [`GET /learners/${ID}`]: [200, learner(EARLY, { learnerRequestsAllowed: false })] })
    renderAt(`/l/${ID}/onska`)
    expect(await screen.findByText('Be en vuxen om ett nytt uppdrag.')).toBeInTheDocument()
  })
})

describe('free requests (middle, upper)', () => {
  it('middle: a suggestion chip fills the text, with an optional theme', async () => {
    const calls = mockApi({
      [`GET /learners/${ID}`]: [200, learner(MIDDLE)],
      [`POST /learners/${ID}/generate`]: [202, { jobId: 'j1' }],
      'GET /jobs/j1': [200, job('processing')],
    })
    renderAt(`/l/${ID}/onska`)
    await userEvent.click(await screen.findByRole('button', { name: 'Jag vill lära mig bråk med flygplan' }))
    expect(screen.getByLabelText('Vad vill du lära dig?')).toHaveValue('Jag vill lära mig bråk med flygplan')
    await userEvent.click(screen.getByRole('button', { name: 'Djur' }))
    await userEvent.click(screen.getByRole('button', { name: 'Skapa' }))
    expect(await screen.findByText('Vi gör ditt uppdrag …')).toBeInTheDocument()
    expect(calls.find((c) => c.key.startsWith('POST'))!.body).toEqual({
      instructions: 'Jag vill lära mig bråk med flygplan',
      theme: 'Djur',
    })
  })

  it('middle: the guided choices are an alternative', async () => {
    mockApi({
      [`GET /learners/${ID}`]: [200, learner(MIDDLE)],
      'GET /curriculum/subjects': [200, { subjects: [{ code: 'GRGRMAT01', name: 'Matematik' }] }],
    })
    renderAt(`/l/${ID}/onska`)
    await userEvent.click(await screen.findByRole('button', { name: 'Välj steg för steg i stället' }))
    expect(await screen.findByRole('button', { name: 'Matematik' })).toBeInTheDocument()
  })

  it('upper: free text from the dashboard', async () => {
    const calls = mockApi({
      [`GET /learners/${ID}`]: [200, learner(UPPER)],
      [`POST /learners/${ID}/generate`]: [202, { jobId: 'j1' }],
      'GET /jobs/j1': [200, job('processing')],
    })
    renderAt()
    await userEvent.click(await screen.findByRole('button', { name: 'Förhör mig på fotosyntesen' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Skapa' })[0])
    await waitFor(() => expect(calls.some((c) => c.key.startsWith('POST'))).toBe(true))
    expect(calls.find((c) => c.key.startsWith('POST'))!.body).toEqual({ instructions: 'Förhör mig på fotosyntesen' })
  })

  it('upper: a practice test with count, difficulty, kinds and feedback mode', async () => {
    const calls = mockApi({
      [`GET /learners/${ID}`]: [200, learner(UPPER)],
      [`POST /learners/${ID}/generate`]: [202, { jobId: 'j1' }],
      'GET /jobs/j1': [200, job('processing')],
    })
    renderAt()
    const count = await screen.findByLabelText('Antal frågor')
    await userEvent.clear(count)
    await userEvent.type(count, '20')
    await userEvent.selectOptions(screen.getByLabelText('Svårighet'), 'Utmanande')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Flerval' }))
    await userEvent.click(screen.getByRole('radio', { name: /I slutet/ }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Skapa' })[1])
    await waitFor(() => expect(calls.some((c) => c.key.startsWith('POST'))).toBe(true))
    expect(calls.find((c) => c.key.startsWith('POST'))!.body).toEqual({
      type: 'practiceTest',
      questionCount: 20,
      difficulty: 4,
      feedback: 'end',
      itemKinds: ['multipleChoice'],
    })
  })
})

describe('AI unavailable', () => {
  const tech = 'AI-leverantören svarade 503 (ai_unavailable)'

  it('a refused request shows only the calm message', async () => {
    mockApi({
      [`GET /learners/${ID}`]: [200, learner(MIDDLE)],
      [`POST /learners/${ID}/generate`]: [503, { error: { code: 'ai_unavailable', message: tech } }],
    })
    renderAt(`/l/${ID}/onska`)
    await userEvent.type(await screen.findByLabelText('Vad vill du lära dig?'), 'bråk')
    await userEvent.click(screen.getByRole('button', { name: 'Skapa' }))
    expect(await screen.findByText(CALM_FAILURE)).toBeInTheDocument()
    expect(screen.queryByText(new RegExp('503|ai_unavailable'))).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Prova igen' }))
    expect(screen.getByLabelText('Vad vill du lära dig?')).toBeInTheDocument()
  })

  it('a failed job shows only the calm message', async () => {
    mockApi({
      [`GET /learners/${ID}`]: [200, learner(EARLY)],
      [`POST /learners/${ID}/generate`]: [202, { jobId: 'j1' }],
      'GET /jobs/j1': [
        200,
        job('failed', { error: { code: 'ai_unavailable', learnerMessage: 'x', adultMessage: tech, retryable: true } }),
      ],
    })
    renderAt(`/l/${ID}/onska`)
    await userEvent.click(await screen.findByRole('button', { name: 'Läsa' }))
    await userEvent.click(screen.getByRole('button', { name: 'Flygplan' }))
    await act(() => userEvent.click(screen.getByRole('button', { name: 'Skapa uppdrag' })))
    expect(await screen.findByText(CALM_FAILURE)).toBeInTheDocument()
    expect(screen.queryByText(tech)).not.toBeInTheDocument()
  })
})
