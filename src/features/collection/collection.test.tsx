import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { missionsLeft, VEHICLES, vehicleById } from '../../content/vehicles'
import { RAIL_VEHICLES } from '../../content/vehicles/rail'
import type { AreaId, VehicleCategory } from '../../core/types'
import { defaultState } from '../../store/state'
import { actions } from '../../store/store'
import { CollectionPage } from './CollectionPage'
import { lockedHint, nextIds } from './remaining'
import { VehicleDetailPage } from './VehicleDetailPage'

const withMissions = (m: Partial<Record<AreaId, number>>) => {
  const s = defaultState()
  actions._replace({ ...s, missions: { ...s.missions, ...m } })
}

const renderAt = (path: string) =>
  render(
    <RouterProvider
      router={createMemoryRouter(
        [
          { path: '/samling', element: <CollectionPage /> },
          { path: '/samling/:id', element: <VehicleDetailPage /> },
        ],
        { initialEntries: [path] },
      )}
    />,
  )

beforeEach(() => withMissions({}))

describe('collection page', () => {
  it('derives locked/unlocked state from missions', () => {
    renderAt('/samling')
    expect(screen.getByText(`Du har 0 av ${VEHICLES.length}`)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /X2000/ })).toBeNull()
    withMissions({ stationen: 1 })
    renderAt('/samling')
    expect(screen.getAllByRole('link', { name: /X2000/ }).length).toBeGreaterThan(0)
  })
})

describe('locked hints', () => {
  const iore = vehicleById('iore')!
  const x60 = vehicleById('x60')!
  it('shows a count only for the next unlock per area', () => {
    const m = defaultStateWith({ stationen: 2 })
    const next = nextIds(RAIL_VEHICLES, m)
    expect(next.has('x31')).toBe(true) // needs 3, has 2
    expect(next.has('iore')).toBe(false)
    expect(lockedHint(vehicleById('x31')!, m, true)).toBe('1 uppdrag kvar i Stationen')
    expect(lockedHint(iore, m, false)).toBe('Låst · Stationen')
    expect(missionsLeft(iore, m)).toBe(3) // 5 needed - 2 done
    expect(missionsLeft(x60, m)).toBe(0)
  })
  it('links locked cards to their area, but not "any" ones', () => {
    renderAt('/samling')
    expect(screen.getAllByRole('link', { name: /Låst fordon/ })[0]).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/omrade\//),
    )
    expect(screen.getAllByText(/Låst/).length).toBeGreaterThan(0)
  })
})

function defaultStateWith(m: Partial<Record<AreaId, number>>) {
  return { ...defaultState().missions, ...m }
}

describe('vehicle detail page', () => {
  it('does not reveal facts for a locked vehicle', () => {
    const v = vehicleById('iore')!
    renderAt(`/samling/${v.id}`)
    expect(screen.getByText(/inte hittat än/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Till samlingen' })).toBeInTheDocument()
    expect(screen.queryByText(v.name)).toBeNull()
    for (const f of v.facts) expect(screen.queryByText(f)).toBeNull()
  })
  it('handles unknown ids calmly', () => {
    renderAt('/samling/nope')
    expect(screen.getByText(/inte hittat än/)).toBeInTheDocument()
  })
  it('shows facts and child-friendly specs when unlocked', () => {
    withMissions({ stationen: 1 })
    renderAt('/samling/x2000')
    expect(screen.getByRole('heading', { name: 'X2000' })).toBeInTheDocument()
    expect(screen.getByText('Började köra')).toBeInTheDocument()
    expect(screen.getByText('1990')).toBeInTheDocument()
    expect(screen.getByText('ungefär 200 km/h')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Till samlingen' })).toBeInTheDocument()
  })
})

describe('rail unlock policy', () => {
  const areaFor: Partial<Record<VehicleCategory, AreaId>> = {
    train: 'stationen',
    metro: 'tunnelbanan',
    tram: 'sparvagnen',
  }
  it('maps categories to areas with ascending missions', () => {
    const seen: Record<string, number[]> = {}
    for (const v of RAIL_VEHICLES) {
      if (v.id === 'x2000') {
        expect(v.unlock).toEqual({ area: 'any', missions: 1 })
        continue
      }
      expect(v.unlock.area).toBe(areaFor[v.category])
      ;(seen[v.unlock.area] ??= []).push(v.unlock.missions)
    }
    for (const list of Object.values(seen)) expect(list).toEqual(list.map((_, i) => i + 1))
  })
  it('has sourced data and 2-4 facts', () => {
    expect(RAIL_VEHICLES).toHaveLength(10)
    for (const v of RAIL_VEHICLES) {
      expect(v.sources.length).toBeGreaterThan(0)
      expect(v.facts.length).toBeGreaterThanOrEqual(2)
      expect(v.facts.length).toBeLessThanOrEqual(4)
    }
  })
})
