import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LearnerProfileInput, type Artifact, type LearnerProfile } from '../../../shared/contracts'
import { AdultArea } from './AdultArea'
import { apiError, mockApi, reply } from './test-api'

const ID = '11111111-1111-4111-8111-111111111111'
const AID = '22222222-2222-4222-8222-222222222222'
const JOB = '33333333-3333-4333-8333-333333333333'

const profile: LearnerProfile = {
  ...LearnerProfileInput.parse({ displayName: 'Jack', school: { stage: 'grundskola', year: 1 } }),
  subjectLevels: [{ subjectCode: 'GRGRMAT01', description: 'räknar till 100', relativeLevel: 4 }],
  id: ID,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
}
const status = {
  ready: true,
  capabilities: [{ capability: 'text', configured: true, reachable: 'yes', label: 'AI-text är tillgänglig' }],
  features: { webResearch: false, externalAssets: true, imageGeneration: false },
  limits: { maxUploadFileMb: 30, maxUploadTotalMb: 300, maxPagesPerSet: 80 },
}
const base = (adult = true) => ({
  'GET /gate': { pinSet: true, adult },
  'GET /system/status': status,
  'GET /learners': [{ id: ID, displayName: 'Jack', school: profile.school, ageBand: 'early' }],
  [`GET /learners/${ID}`]: profile,
  [`GET /learners/${ID}/artifacts`]: [],
  [`GET /learners/${ID}/study-sets`]: [],
  'GET /curriculum/subjects': { version: 'v1', subjects: [{ code: 'GRGRMAT01', name: 'Matematik' }] },
  'POST /gate/lock': { pinSet: true, adult: false },
})

function setup(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/vuxen/*', element: <AdultArea /> },
      { path: '/', element: <p>Startsidan</p> },
    ],
    { initialEntries: [path] },
  )
  render(<RouterProvider router={router} />)
  return router
}

const typePin = async (pin: string, submit: string) => {
  await userEvent.type(screen.getByLabelText('Vuxenkod'), pin)
  await userEvent.click(screen.getByRole('button', { name: submit }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('adult gate', () => {
  it('rejects a wrong PIN calmly, shows the throttle message, unlocks and locks', async () => {
    let tries = 0
    mockApi({
      ...base(false),
      'POST /gate/unlock': (b: unknown) => {
        tries++
        if (tries === 2) return apiError(429, 'limit_exceeded')
        return (b as { pin: string }).pin === '2468' ? { pinSet: true, adult: true } : apiError(403, 'wrong_pin')
      },
    })
    const router = setup('/vuxen')
    await screen.findByRole('heading', { name: 'Skriv vuxenkoden' })
    await typePin('1111', 'Öppna')
    expect(await screen.findByText('Det blev inte rätt. Försök igen.')).toBeInTheDocument()
    await typePin('1111', 'Öppna')
    expect(await screen.findByText(/För många försök/)).toBeInTheDocument()
    // keypad works as well as the keyboard
    for (const d of ['2', '4', '6', '8']) await userEvent.click(screen.getByRole('button', { name: d }))
    await userEvent.click(screen.getByRole('button', { name: 'Öppna' }))
    expect(await screen.findByRole('heading', { name: 'Elever' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Jack' })).toBeInTheDocument()
    expect(screen.getByText('AI-text är tillgänglig')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Lås' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('re-shows the gate when the API answers 403 adult_required', async () => {
    mockApi({ ...base(), [`GET /learners/${ID}/artifacts`]: apiError(403, 'adult_required') })
    setup('/vuxen')
    expect(await screen.findByRole('heading', { name: 'Skriv vuxenkoden' })).toBeInTheDocument()
  })

  it('shows a plain notice when AI is not ready', async () => {
    mockApi({ ...base(), 'GET /system/status': { ...status, ready: false } })
    setup('/vuxen')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'AI-funktionerna är inte tillgängliga. Den som driftar JackApp behöver kontrollera inställningarna.',
    )
  })
})

describe('profile editor', () => {
  it('keeps support separate from difficulty and saves support choices', async () => {
    const { calls } = mockApi({
      ...base(),
      [`PATCH /learners/${ID}`]: (b: unknown) => ({ ...profile, ...(b as object) }),
    })
    setup(`/vuxen/elev/${ID}`)
    expect(await screen.findByText('Stöd i presentationen påverkar inte hur svårt innehållet är.')).toBeInTheDocument()
    const text = screen.getByRole('group', { name: 'Mängd text' })
    await userEvent.click(within(text).getByLabelText('Så lite text som möjligt'))
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Högst antal svarsalternativ' })).getByLabelText('3'),
    )
    await userEvent.click(screen.getByLabelText('Steg för steg'))
    await userEvent.click(screen.getByRole('button', { name: 'Spara profilen' }))
    expect(await screen.findByText('Sparat.')).toBeInTheDocument()
    const body = calls.find((c) => c.method === 'PATCH')!.body as LearnerProfileInput
    expect(body.support).toMatchObject({ textAmount: 'minimal', maxChoices: 3, stepByStep: true })
    // the academic level is untouched by support changes
    expect(body.subjectLevels).toEqual(profile.subjectLevels)
  })

  it('imports legacy progress without deleting it from the device', async () => {
    const legacy = { version: 1, progress: { 'math.add': { level: 2 } }, parentPin: '1234' }
    localStorage.setItem('jackapp:v1', JSON.stringify(legacy))
    const { calls } = mockApi({
      ...base(),
      [`POST /learners/${ID}/legacy-import`]: reply(201, { importId: 'x', created: true, skills: 1, skipped: [] }),
    })
    setup(`/vuxen/elev/${ID}`)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Importera framsteg från den här enheten (tidigare JackApp)' }),
    )
    expect(await screen.findByText(/Framsteg för 1 färdigheter importerades/)).toBeInTheDocument()
    expect(calls.find((c) => c.path.endsWith('/legacy-import'))!.body).toEqual(legacy)
    expect(localStorage.getItem('jackapp:v1')).toBe(JSON.stringify(legacy))
  })

  it('deletes a learner only after confirming', async () => {
    const { calls } = mockApi({ ...base(), [`DELETE /learners/${ID}`]: reply(204) })
    const router = setup(`/vuxen/elev/${ID}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Ta bort Jack' }))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Ja, ta bort' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/vuxen'))
  })
})

describe('generation', () => {
  it('sends only what the adult chose and follows the job to the result', async () => {
    const { calls } = mockApi({
      ...base(),
      [`POST /learners/${ID}/generate`]: reply(202, { jobId: JOB }),
      [`GET /jobs/${JOB}`]: { id: JOB, state: 'completed', progress: 1, resultId: AID, type: 'artifact.generate' },
    })
    setup(`/vuxen/elev/${ID}/skapa`)
    await userEvent.type(await screen.findByLabelText('Vad vill du skapa?'), 'Tio uppgifter om tåg')
    await userEvent.selectOptions(screen.getByLabelText('Typ av material'), 'practiceTest')
    await userEvent.click(screen.getByRole('button', { name: 'Skapa' }))
    expect(await screen.findByRole('link', { name: 'Öppna materialet' })).toHaveAttribute(
      'href',
      `/vuxen/elev/${ID}/material/${AID}`,
    )
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      instructions: 'Tio uppgifter om tåg',
      type: 'practiceTest',
    })
  })

  it('uploads pictures inline and waits for them before creating', async () => {
    const { calls } = mockApi(base())
    setup(`/vuxen/elev/${ID}/skapa`)
    await userEvent.type(await screen.findByLabelText('Vad vill du skapa?'), 'Prov på kapitlet')
    await userEvent.selectOptions(screen.getByLabelText('Studiematerial'), 'new')
    expect(await screen.findByRole('heading', { name: 'Ladda upp studiematerial' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Skapa' }))
    expect(await screen.findByText('Ladda upp bilderna först, eller välj Inget.')).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
    await userEvent.selectOptions(screen.getByLabelText('Studiematerial'), '')
    expect(screen.queryByRole('heading', { name: 'Ladda upp studiematerial' })).not.toBeInTheDocument()
  })

  it('shows the adult failure message', async () => {
    mockApi({
      ...base(),
      [`POST /learners/${ID}/generate`]: reply(202, { jobId: JOB }),
      [`GET /jobs/${JOB}`]: {
        id: JOB,
        state: 'failed',
        progress: 0,
        error: { code: 'ai_unavailable', adultMessage: 'AI-tjänsten svarar inte just nu.', retryable: true },
      },
    })
    setup(`/vuxen/elev/${ID}/skapa`)
    await userEvent.type(await screen.findByLabelText('Vad vill du skapa?'), 'Bråk')
    await userEvent.click(screen.getByRole('button', { name: 'Skapa' }))
    expect(await screen.findByText('AI-tjänsten svarar inte just nu.')).toBeInTheDocument()
  })
})

describe('material approval and editing', () => {
  const artifact: Artifact = {
    id: AID,
    learnerId: ID,
    type: 'exercises',
    title: 'Tåg och addition',
    school: profile.school,
    sourceMode: 'sourceAndCurriculum',
    feedback: 'immediate',
    approval: 'pendingApproval',
    version: 1,
    createdBy: 'adult',
    createdAt: '2026-09-01T00:00:00Z',
    validation: {
      ok: true,
      issues: [{ severity: 'warning', code: 'x', itemId: 'i1', message: 'Kontrollera att svaret är entydigt.' }],
      checks: ['schema'],
      checkedAt: '2026-09-01T00:00:00Z',
    },
    sections: [
      {
        kind: 'practice',
        title: 'Öva',
        media: [],
        items: [
          {
            kind: 'multipleChoice',
            id: 'i1',
            prompt: 'Hur mycket är 2 + 3?',
            lang: 'sv',
            media: [],
            hints: [],
            difficulty: 2,
            skills: ['math.addition'],
            sources: [{ kind: 'model', capability: 'text' }],
            curriculumRefs: [],
            choices: [
              { id: 'a', text: '4' },
              { id: 'b', text: '5' },
            ],
            answer: 'b',
          },
        ],
      },
    ],
  }

  it('shows answers and warnings, approves, and saves an edit as a new version', async () => {
    const { calls } = mockApi({
      ...base(),
      [`GET /artifacts/${AID}`]: { artifact, requestedIllustrations: [] },
      [`POST /artifacts/${AID}/approve`]: { ...artifact, approval: 'approved' },
      [`PATCH /artifacts/${AID}`]: {
        ...artifact,
        version: 2,
        sections: [
          { ...artifact.sections[0], items: [{ ...artifact.sections[0]!.items[0], prompt: 'Vad är 2 + 3?' }] },
        ],
      },
    })
    setup(`/vuxen/elev/${ID}/material/${AID}`)
    const right = await screen.findByText('✓ rätt svar')
    expect(right.closest('li')).toHaveTextContent('5')
    expect(screen.getByText(/Kontrollera att svaret är entydigt/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Godkänn' }))
    expect(await screen.findByText('Materialet är godkänt.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Redigera' }))
    const prompt = screen.getByLabelText('Uppgift')
    await userEvent.clear(prompt)
    await userEvent.type(prompt, 'Vad är 2 + 3?')
    await userEvent.click(screen.getByRole('button', { name: 'Spara ändringen' }))
    expect(await screen.findByText('Vad är 2 + 3?')).toBeInTheDocument()
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({ version: 1 })
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({
      items: { i1: { prompt: 'Vad är 2 + 3?' } },
      version: 1,
    })
  })

  it('a version conflict shows a calm message and reloads the material', async () => {
    const { calls } = mockApi({
      ...base(),
      [`GET /artifacts/${AID}`]: { artifact, requestedIllustrations: [] },
      [`POST /artifacts/${AID}/approve`]: apiError(409, 'version_conflict'),
    })
    setup(`/vuxen/elev/${ID}/material/${AID}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Godkänn' }))
    expect(
      await screen.findByText('Materialet har ändrats. Ladda om för att se den senaste versionen.'),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(calls.filter((c) => c.method === 'GET' && c.path === `/artifacts/${AID}`)).toHaveLength(2),
    )
  })
})
