import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { actions, getState } from '../../store/store'
import { defaultState } from '../../store/state'
import { FreePlayPage } from './FreePlayPage'

function setup(enabled: boolean) {
  const s = defaultState()
  actions._replace({ ...s, settings: { ...s.settings, freePlayEnabled: enabled } })
  const router = createMemoryRouter(
    [
      { path: '/', element: <div>hem</div> },
      { path: '/bygg', element: <FreePlayPage /> },
    ],
    { initialEntries: ['/bygg'] },
  )
  render(<RouterProvider router={router} />)
  return router
}

describe('FreePlayPage', () => {
  beforeEach(() => document.documentElement.removeAttribute('data-motion'))

  it('redirects home when disabled', () => {
    const r = setup(false)
    expect(r.state.location.pathname).toBe('/')
  })

  it('adds stations by button and persists them', async () => {
    setup(true)
    await userEvent.click(screen.getByRole('button', { name: 'Lägg till station' }))
    await userEvent.click(screen.getByRole('button', { name: 'Lägg till station' }))
    expect(getState().freePlay.line?.stations.map((s) => s.name)).toEqual(['Ängen', 'Hamnen'])
    await userEvent.click(screen.getByRole('button', { name: 'Ta bort sista stationen' }))
    expect(getState().freePlay.line?.stations).toHaveLength(1)
  })

  it('chooses a vehicle', async () => {
    setup(true)
    await userEvent.click(screen.getByRole('button', { name: /Spårvagn/ }))
    expect(getState().freePlay.line?.vehicle).toBe('tram')
  })

  it('renames a station and resets after confirm', async () => {
    setup(true)
    await userEvent.click(screen.getByRole('button', { name: 'Lägg till station' }))
    await userEvent.click(screen.getByRole('button', { name: 'Station Ängen' }))
    await userEvent.click(screen.getByRole('button', { name: 'Torget' }))
    expect(getState().freePlay.line?.stations[0].name).toBe('Torget')
    await userEvent.click(screen.getByRole('button', { name: 'Börja om' }))
    expect(getState().freePlay.line?.stations).toHaveLength(1)
    await userEvent.click(screen.getByRole('button', { name: 'Ja, börja om' }))
    expect(getState().freePlay.line?.stations).toHaveLength(0)
  })

  it('steps station to station under reduced motion', async () => {
    document.documentElement.dataset.motion = 'reduced'
    setup(true)
    await userEvent.click(screen.getByRole('button', { name: 'Lägg till station' }))
    await userEvent.click(screen.getByRole('button', { name: 'Lägg till station' }))
    await userEvent.click(screen.getByRole('button', { name: 'Nästa station' }))
    expect(screen.getByText('Här: Hamnen')).toBeInTheDocument()
  })
})
