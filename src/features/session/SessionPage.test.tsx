import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AreaId } from '../../core/types'
import { defaultState } from '../../store/state'
import { actions, getState } from '../../store/store'
import { SessionPage } from './SessionPage'

const NOT_A_CHOICE = /^(Lyssna|Hör på engelska|Hör ordet|På svenska|Nästa|Klart)$/

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/omrade/:area/uppdrag', element: <SessionPage /> },
      { path: '/samling/:id', element: <div>vehicle page</div> },
      { path: '/', element: <div>home</div> },
    ],
    { initialEntries: [path] },
  )
  render(<RouterProvider router={router} />)
  return router
}

/** Clicks enabled choices until "Nästa"/"Klart" appears (works for choice and order tasks), then continues. */
async function solveCurrent() {
  for (let i = 0; i < 40; i++) {
    const next = screen.queryByRole('button', { name: /^(Nästa|Klart)$/ })
    if (next) return userEvent.click(next)
    const open = screen
      .getAllByRole('button')
      .find((b) => b.getAttribute('aria-disabled') !== 'true' && !NOT_A_CHOICE.test(b.textContent ?? ''))
    await userEvent.click(open!)
  }
  throw new Error('question not solved')
}

const solveMission = async () => {
  for (let i = 0; i < 4; i++) await solveCurrent()
}

beforeEach(() => actions._replace(defaultState()))

describe('SessionPage', () => {
  it('completing 4 questions counts a mission, logs the session and shows the done panel', async () => {
    renderAt('/omrade/tunnelbanan/uppdrag')
    await solveMission()
    expect(screen.getByRole('heading', { name: /Bra jobbat!/ })).toBeInTheDocument()
    expect(getState().missions.tunnelbanan).toBe(1)
    expect(getState().sessions).toHaveLength(1)
    expect(getState().sessions[0]).toMatchObject({ area: 'tunnelbanan', total: 4 })
  })

  it('redirects an unknown area home', () => {
    renderAt('/omrade/nope/uppdrag')
    expect(screen.getByText('home')).toBeInTheDocument()
  })

  it('records attempts per planned skill', async () => {
    renderAt('/omrade/tunnelbanan/uppdrag')
    await solveMission()
    const progress = Object.entries(getState().progress)
    expect(progress.length).toBeGreaterThanOrEqual(1)
    expect(
      progress.every(([k]) =>
        ['math.count', 'math.compare', 'math.oneMoreLess', 'math.sequence', 'math.add', 'math.sub'].includes(k),
      ),
    ).toBe(true)
    expect(progress.reduce((n, [, p]) => n + p!.attempts, 0)).toBe(4)
    expect(getState().recentQuestionIds).toHaveLength(4)
  })

  it('"Ett uppdrag till" starts a new run', async () => {
    renderAt('/omrade/stationen/uppdrag')
    await solveMission()
    await userEvent.click(screen.getByRole('button', { name: 'Ett uppdrag till' }))
    expect(screen.queryByRole('heading', { name: /Bra jobbat!/ })).not.toBeInTheDocument()
    await solveMission()
    expect(getState().missions.stationen).toBe(2)
    expect(getState().sessions).toHaveLength(2)
  })

  it('announces a newly unlocked vehicle and links to it', async () => {
    const area: AreaId = 'flygplatsen'
    const s = defaultState()
    s.missions[area] = 0 // Gripen unlocks at flygplatsen mission 1
    actions._replace(s)
    renderAt(`/omrade/${area}/uppdrag`)
    await solveMission()
    expect(screen.getByText('Gripen')).toBeInTheDocument()
    expect(screen.getAllByText(/Ny i din samling/).length).toBeGreaterThanOrEqual(1)
    await userEvent.click(screen.getByRole('link', { name: /Titta på Gripen/ }))
    expect(screen.getByText('vehicle page')).toBeInTheDocument()
  })
})
