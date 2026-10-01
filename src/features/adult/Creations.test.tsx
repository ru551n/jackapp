import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LearnerProfileInput, type CreationJob } from '../../../shared/contracts'
import { AdultArea } from './AdultArea'
import { mockApi, reply } from './test-api'

const ID = '11111111-1111-4111-8111-111111111111'
const AID = '22222222-2222-4222-8222-222222222222'
const profile = {
  ...LearnerProfileInput.parse({ displayName: 'Jack', school: { stage: 'grundskola', year: 4 } }),
  id: ID,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
}
const job = (id: string, extra: Partial<CreationJob>): CreationJob => ({
  id: `00000000-0000-4000-8000-00000000000${id}`,
  type: 'artifact.generate',
  learnerId: ID,
  state: 'queued',
  progress: 0,
  title: `Jobb ${id}`,
  createdAt: '2026-09-30T10:00:00Z',
  updatedAt: '2026-09-30T10:00:00Z',
  ...extra,
})
const JOBS = [
  job('1', { title: 'Bråk med tåg' }),
  job('2', { state: 'processing', progress: 0.4, title: 'Läsförståelse om rymden', createdBy: 'learner' }),
  job('3', {
    state: 'completed',
    progress: 1,
    title: 'Prov om vulkaner',
    artifactId: AID,
    approval: 'pendingApproval',
  }),
  job('4', {
    state: 'failed',
    title: 'Lektion: Bråk',
    error: { code: 'ai_unavailable', learnerMessage: 'l', adultMessage: 'AI-tjänsten svarar inte.', retryable: true },
  }),
]
const active = JOBS.slice(0, 2)
const base = {
  'GET /gate': { pinSet: true, adult: true },
  'GET /system/status': {
    ready: true,
    capabilities: [],
    features: { webResearch: false, externalAssets: true, imageGeneration: false },
    limits: { maxUploadFileMb: 30, maxUploadTotalMb: 300, maxPagesPerSet: 80 },
  },
  'GET /learners': [{ id: ID, displayName: 'Jack', school: profile.school, ageBand: 'middle' }],
  [`GET /learners/${ID}`]: profile,
  [`GET /learners/${ID}/skills`]: { skills: [], patterns: [] },
  [`GET /learners/${ID}/artifacts`]: [],
  [`GET /learners/${ID}/study-sets`]: [],
  'GET /curriculum/subjects': { subjects: [] },
  [`GET /learners/${ID}/jobs`]: JOBS,
  [`GET /learners/${ID}/jobs?active=1`]: active,
  'GET /jobs': JOBS,
  'GET /jobs?active=1': active,
}

function setup(path: string) {
  render(
    <RouterProvider
      router={createMemoryRouter([{ path: '/vuxen/*', element: <AdultArea /> }], { initialEntries: [path] })}
    />,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('creation queue (adult)', () => {
  it('lists active and recent creations on the Material page, with retry for failures', async () => {
    const { calls } = mockApi({ ...base, [`POST /jobs/${JOBS[3]!.id}/retry`]: { ...JOBS[3], state: 'queued' } })
    setup(`/vuxen/elev/${ID}/material`)
    const section = within(await screen.findByRole('region', { name: 'Pågår och klart' }))
    expect(section.getByText('I kö')).toBeInTheDocument()
    expect(section.getByText('Skapas … 40 %')).toBeInTheDocument()
    expect(section.getByText(/önskat av eleven/)).toBeInTheDocument()
    expect(section.getByText('Klar – väntar på godkännande')).toBeInTheDocument()
    expect(section.getByRole('link', { name: 'Prov om vulkaner' })).toHaveAttribute(
      'href',
      `/vuxen/elev/${ID}/material/${AID}`,
    )
    expect(section.getByText('Gick inte att skapa')).toBeInTheDocument()
    expect(section.getByText('AI-tjänsten svarar inte.')).toBeInTheDocument()
    await userEvent.click(section.getByRole('button', { name: 'Försök igen' }))
    expect(calls.some((c) => c.method === 'POST' && c.path === `/jobs/${JOBS[3]!.id}/retry`)).toBe(true)
    // The sub-nav Material tab counts what is being made.
    expect(await screen.findByRole('link', { name: /Material\s*2 skapas/ })).toBeInTheDocument()
  })

  it('shows "Skapas: N" in the header everywhere, linking to the household list', async () => {
    mockApi(base)
    setup('/vuxen')
    await userEvent.click(await screen.findByRole('link', { name: 'Skapas: 2' }))
    expect(await screen.findByRole('heading', { name: 'Pågår och klart' })).toBeInTheDocument()
    expect(await screen.findByText('Jack: Bråk med tåg')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Jack: Prov om vulkaner' })).toBeInTheDocument()
  })

  it('hides the indicator when nothing is being made', async () => {
    mockApi({ ...base, 'GET /jobs?active=1': [] })
    setup('/vuxen')
    expect(await screen.findByRole('heading', { name: 'Elever' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Skapas:/ })).not.toBeInTheDocument()
  })

  it('says the request is queued and can be left after "Skapa"', async () => {
    mockApi({
      ...base,
      [`POST /learners/${ID}/generate`]: reply(202, { jobId: JOBS[0]!.id }),
      [`GET /jobs/${JOBS[0]!.id}`]: { ...JOBS[0], attempts: 0 },
    })
    setup(`/vuxen/elev/${ID}/skapa`)
    await userEvent.type(await screen.findByLabelText('Vad vill du skapa?'), 'Bråk med tåg')
    await userEvent.click(screen.getByRole('button', { name: 'Skapa' }))
    expect(await screen.findByText(/Läggs i kön – du kan lämna sidan/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Material' })).toHaveAttribute('href', `/vuxen/elev/${ID}/material`)
  })
})
