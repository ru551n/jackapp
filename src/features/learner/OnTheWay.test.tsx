import { render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SupportPreferences, type CreationJob } from '../../../shared/contracts'
import { mockApi } from '../adult/test-api'
import type { LearnerView } from './api'
import { LearnerArea } from './index'

const ID = '00000000-0000-4000-8000-000000000001'
const AID = '22222222-2222-4222-8222-222222222222'
const school = { stage: 'grundskola', year: 5 } as const
const view: LearnerView = {
  id: ID,
  displayName: 'Jack',
  school,
  language: 'sv',
  presentation: { ...SupportPreferences.parse({}), ageBand: 'middle', school },
  learnerRequestsAllowed: true,
}
const job = (n: number, extra: Partial<CreationJob>): CreationJob => ({
  id: `00000000-0000-4000-8000-00000000010${n}`,
  type: 'artifact.generate',
  state: 'completed',
  progress: 1,
  title: `Jobb ${n}`,
  createdAt: '2026-09-30T10:00:00Z',
  updatedAt: '2026-09-30T10:00:00Z',
  createdBy: 'learner',
  ...extra,
})

afterEach(() => vi.unstubAllGlobals())

describe('"På gång" (learner home)', () => {
  it('shows own requests calmly: being made, waiting for an adult, ready to open; rejected ones leave', async () => {
    mockApi({
      [`GET /learners/${ID}`]: view,
      'POST /gate/lock': {},
      [`GET /learners/${ID}/jobs`]: [
        job(1, { state: 'processing', progress: 0.3, title: 'Bråk med flygplan' }),
        job(2, { title: 'Läsförståelse om rymden', artifactId: AID, approval: 'pendingApproval' }),
        job(3, { title: 'Övningsprov: Vulkaner', artifactId: AID, approval: 'approved' }),
        job(4, { title: 'Avvisat', artifactId: AID, approval: 'rejected' }),
        job(5, {
          state: 'failed',
          title: 'Engelska ord',
          error: {
            code: 'x',
            learnerMessage: 'Det gick inte att skapa uppgiften just nu.',
            adultMessage: '',
            retryable: true,
          },
        }),
      ],
    })
    render(
      <RouterProvider
        router={createMemoryRouter([{ path: '/l/:learnerId/*', element: <LearnerArea /> }], {
          initialEntries: [`/l/${ID}`],
        })}
      />,
    )
    const panel = within(await screen.findByRole('region', { name: 'På gång' }))
    expect(panel.getByText('Bråk med flygplan')).toBeInTheDocument()
    expect(panel.getByText('Skapas …')).toBeInTheDocument()
    expect(panel.getByText('En vuxen tittar på det först')).toBeInTheDocument()
    expect(panel.getByRole('link', { name: 'Klart – öppna' })).toHaveAttribute('href', `/l/${ID}/material/${AID}`)
    expect(panel.getByText('Det gick inte att skapa uppgiften just nu.')).toBeInTheDocument()
    expect(panel.queryByText('Avvisat')).not.toBeInTheDocument()
    expect(panel.queryByText(/fel/i)).not.toBeInTheDocument()
  })
})
