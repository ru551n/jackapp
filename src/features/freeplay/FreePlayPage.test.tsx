import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { actions, getState } from '../../store/store'
import { defaultState } from '../../store/state'
import { FreePlayPage } from './FreePlayPage'

function setup(enabled: boolean, motion: 'system' | 'reduced' | 'full' = 'full') {
  const s = defaultState()
  actions._replace({ ...s, settings: { ...s.settings, freePlayEnabled: enabled, motion } })
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
  it('redirects home when disabled', () => {
    const r = setup(false)
    expect(r.state.location.pathname).toBe('/')
  })

  it('adds stations by button and persists them', async () => {
    setup(true)
    await userEvent.click(screen.getByRole('button', { name: 'Lägg till station' }))
    await userEvent.click(screen.getByRole('button', { name: 'Lägg till station' }))
    expect(getState().freePlay.line?.stations.map((s) => s.name)).toEqual(['Ängen', 'Hamnen'])
    await userEvent.click(screen.getByRole('button', { name: 'Ta bort station' }))
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
    setup(true, 'reduced')
    await userEvent.click(screen.getByRole('button', { name: 'Lägg till station' }))
    await userEvent.click(screen.getByRole('button', { name: 'Lägg till station' }))
    await userEvent.click(screen.getByRole('button', { name: 'Nästa station' }))
    expect(screen.getByText('Här: Hamnen')).toBeInTheDocument()
  })

  it('shows Kör with full motion and the step button with reduced', () => {
    setup(true, 'full')
    expect(screen.getByRole('button', { name: 'Kör' })).toBeDisabled()
    expect(screen.getByText('Lägg till minst två stationer')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nästa station' })).toBeNull()
  })

  it('moves focus to the panel heading and back to the station', async () => {
    setup(true)
    await userEvent.click(screen.getByRole('button', { name: 'Lägg till station' }))
    const station = screen.getByRole('button', { name: 'Station Ängen' })
    await userEvent.click(station)
    expect(screen.getByRole('heading', { name: 'Namn på stationen' })).toHaveFocus()
    await userEvent.click(screen.getByRole('button', { name: 'Klar' }))
    expect(screen.getByRole('button', { name: 'Station Ängen' })).toHaveFocus()
  })
})
