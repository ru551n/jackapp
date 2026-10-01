import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SupportPreferences, type SchoolPosition } from '../../../shared/contracts'
import { bandOf, type LearnerView } from './api'
import { LearnerArea } from './index'

const ID = '00000000-0000-4000-8000-000000000001'
const EARLY = { stage: 'grundskola', year: 1 } as const
const MIDDLE = { stage: 'grundskola', year: 5 } as const

function learner(school: SchoolPosition, extra: Partial<LearnerView> = {}, support = {}): LearnerView {
  return {
    id: ID,
    displayName: 'Jack',
    school,
    language: 'sv',
    presentation: { ...SupportPreferences.parse(support), ageBand: bandOf({ school }), school },
    learnerRequestsAllowed: true,
    ...extra,
  }
}

/** Stubs fetch: "METHOD /path" → JSON; unknown GETs return []. */
function mockApi(routes: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${url.replace('/api/v1', '').split('?')[0]}`
      const data = key in routes ? routes[key] : key.startsWith('GET') ? [] : {}
      return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } })
    }),
  )
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

const missions = [{ id: 'a1', title: 'Addition', type: 'exercises', subjectCode: 'GRGRMAT01' }]

afterEach(() => {
  vi.unstubAllGlobals()
  delete document.documentElement.dataset.band
  delete document.documentElement.dataset.motion
})

describe('early home', () => {
  it('puts new missions first', async () => {
    mockApi({ [`GET /learners/${ID}`]: learner(EARLY), [`GET /learners/${ID}/artifacts`]: missions })
    renderAt()
    await screen.findByRole('link', { name: /Nya uppdrag/ })
    expect(screen.getAllByRole('link')[0]).toHaveAccessibleName(/Nya uppdrag/)
  })

  it('"Enklare skärmbild": fewer tiles, the rest behind "Mer"', async () => {
    mockApi({
      [`GET /learners/${ID}`]: learner(EARLY, {}, { reducedVisualComplexity: true, maxChoices: 3 }),
      [`GET /learners/${ID}/artifacts`]: missions,
    })
    renderAt()
    await screen.findByRole('link', { name: /Nya uppdrag/ })
    const nav = screen.getByRole('navigation', { name: 'Välj vart du vill åka' })
    expect(nav.querySelectorAll('a')).toHaveLength(3)
    await userEvent.click(screen.getByRole('button', { name: /Mer/ }))
    expect(screen.getByRole('link', { name: /Min samling/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mer/ })).toBeNull()
  })

  it('"Byt elev" asks first, calmly', async () => {
    mockApi({ [`GET /learners/${ID}`]: learner(EARLY) })
    const router = renderAt()
    await userEvent.click(await screen.findByRole('link', { name: 'Byt elev' }))
    expect(screen.getByText('Vill du byta till någon annan?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Nej' }))
    expect(router.state.location.pathname).toBe(`/l/${ID}`)
    await userEvent.click(screen.getByRole('link', { name: 'Byt elev' }))
    await userEvent.click(screen.getByRole('link', { name: 'Ja' }))
    expect(router.state.location.pathname).toBe('/')
  })
})

describe('requests and material (middle)', () => {
  it('suggestion chips follow the learner’s interests', async () => {
    mockApi({ [`GET /learners/${ID}`]: learner(MIDDLE, { interests: ['Fotboll'] }) })
    renderAt(`/l/${ID}/onska`)
    expect(await screen.findByRole('button', { name: 'Jag vill lära mig bråk med fotboll' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /flygplan/ })).toBeNull()
  })

  it('results end with "Klar – till start" and "Öva mer" opens a prefilled request', async () => {
    const R = `/learners/${ID}/runs`
    mockApi({
      [`GET /learners/${ID}`]: learner(MIDDLE),
      'GET /artifacts/a1': { artifact: { id: 'a1', title: 'Addition', sections: [] } },
      [`POST ${R}`]: {
        id: 'r1',
        title: 'Addition',
        feedback: 'immediate',
        items: [{ id: 'i1', kind: 'numeric', prompt: 'Vad är 2 + 2?', skills: ['math.add'] }],
        progress: {},
        summary: {
          answered: 1,
          total: 1,
          correct: 0,
          message: 'Du klarade 0 av 1. Bra kämpat!',
          skills: [{ skill: 'math.add', correct: 0, total: 1, note: 'Värt att öva lite mer på.' }],
          review: [],
          selfAssess: [],
        },
      },
    })
    const router = renderAt(`/l/${ID}/material/a1`)
    expect(await screen.findByRole('button', { name: 'Klar – till start' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Öva mer på det här' }))
    await waitFor(() => expect(router.state.location.pathname).toBe(`/l/${ID}/onska`))
    expect(await screen.findByLabelText('Vad vill du lära dig?')).toHaveValue('Jag vill öva mer på Addition')
  })
})
