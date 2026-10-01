import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockApi, reply } from '../adult/test-api'
import { StartPage } from './StartPage'

const ID = '11111111-1111-4111-8111-111111111111'

function setup() {
  const router = createMemoryRouter(
    [
      { path: '/', element: <StartPage /> },
      { path: '/vuxen/*', element: <p>Vuxenöversikt</p> },
      { path: '/l/:id', element: <p>Elevens sida</p> },
    ],
    { initialEntries: ['/'] },
  )
  render(<RouterProvider router={router} />)
  return router
}

const typePin = async (label: string, pin: string, submit: string) => {
  await userEvent.type(await screen.findByLabelText(label), pin)
  await userEvent.click(screen.getByRole('button', { name: submit }))
}

afterEach(() => vi.unstubAllGlobals())

describe('start page', () => {
  it('first run: creates the PIN twice, then the first learner, then opens the adult area', async () => {
    const { calls } = mockApi({
      'GET /gate': { pinSet: false, adult: true },
      'GET /learners': [],
      'POST /gate/pin': { pinSet: true, adult: true },
      'POST /learners': reply(201, { id: ID }),
    })
    const router = setup()
    await typePin('Välj en vuxenkod', '1357', 'Nästa')
    await typePin('Skriv koden en gång till', '9999', 'Spara koden')
    expect(await screen.findByText('Koderna var olika. Försök igen.')).toBeInTheDocument()
    await typePin('Välj en vuxenkod', '1357', 'Nästa')
    await typePin('Skriv koden en gång till', '1357', 'Spara koden')

    await userEvent.type(await screen.findByLabelText('Namn'), 'Jack')
    await userEvent.selectOptions(screen.getByLabelText('Skola och årskurs'), 'grundskola:1')
    await userEvent.type(screen.getByLabelText('Intressen'), 'tåg, flygplan')
    await userEvent.click(screen.getByRole('button', { name: 'Klar' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/vuxen'))

    expect(calls.find((c) => c.path === '/gate/pin')!.body).toEqual({ pin: '1357' })
    expect(calls.find((c) => c.method === 'POST' && c.path === '/learners')!.body).toEqual({
      displayName: 'Jack',
      school: { stage: 'grundskola', year: 1 },
      interests: ['tåg', 'flygplan'],
    })
  })

  it('PIN set but no learner yet: asks for the PIN before adding the first learner', async () => {
    mockApi({
      'GET /gate': { pinSet: true, adult: false },
      'GET /learners': [],
      'POST /gate/unlock': { pinSet: true, adult: true },
    })
    setup()
    await typePin('Vuxenkod', '1357', 'Öppna')
    expect(await screen.findByRole('heading', { name: 'Lägg till den första eleven' })).toBeInTheDocument()
  })

  it('otherwise shows the learner picker with a quiet adult link', async () => {
    mockApi({
      'GET /gate': { pinSet: true, adult: false },
      'GET /learners': [
        { id: ID, displayName: 'Jack', school: { stage: 'grundskola', year: 1 }, ageBand: 'early' },
        { id: 'x', displayName: 'Mira', school: { stage: 'gymnasieskola', year: 2 }, ageBand: 'upper' },
      ],
    })
    const router = setup()
    expect(await screen.findByRole('heading', { name: 'Vem ska lära sig?' })).toBeInTheDocument()
    expect(screen.getByText('Gymnasiet år 2')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'För vuxna' })).toHaveAttribute('href', '/vuxen')
    await userEvent.click(screen.getByRole('link', { name: /Jack/ }))
    expect(router.state.location.pathname).toBe(`/l/${ID}`)
  })
})
