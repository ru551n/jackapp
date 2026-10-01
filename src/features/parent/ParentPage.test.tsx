import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { actions, getState } from '../../store/store'
import { defaultState } from '../../store/state'
import { ParentPage } from './ParentPage'

const setup = (pin?: string) => {
  actions._replace({ ...defaultState(), parentPin: pin })
  const router = createMemoryRouter(
    [
      { path: '/vuxen', element: <ParentPage /> },
      { path: '/', element: <p>Hemskärm</p> },
    ],
    { initialEntries: ['/vuxen'] },
  )
  render(<RouterProvider router={router} />)
  return router
}

const solveCheck = async () => {
  const [a, b] = screen
    .getByTestId('sum')
    .textContent!.split('+')
    .map((x) => Number(x))
  await userEvent.type(screen.getByLabelText(/Skriv svaret/), String(a + b))
  await userEvent.click(screen.getByRole('button', { name: 'Fortsätt' }))
}
const typePin = async (label: string | RegExp, pin: string, submit: string) => {
  await userEvent.type(screen.getByLabelText(label), pin)
  await userEvent.click(screen.getByRole('button', { name: submit }))
}
const unlock = async () => {
  await typePin('Skriv din kod', '1234', 'Öppna')
}

describe('parent area', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('gates the dashboard behind adult check and new PIN', async () => {
    setup()
    expect(screen.queryByText('Sammanfattning')).not.toBeInTheDocument()
    await solveCheck()
    await typePin('Välj en kod med 4 siffror', '4321', 'Nästa')
    await typePin('Skriv koden en gång till', '4321', 'Spara koden')
    expect(screen.getByText('Sammanfattning')).toBeInTheDocument()
    expect(getState().parentPin).toBe('4321')
  })

  it('rejects a wrong PIN, accepts the right one, and re-locks', async () => {
    setup('1234')
    await typePin('Skriv din kod', '9999', 'Öppna')
    expect(screen.getByText('Det blev inte rätt. Försök igen.')).toBeInTheDocument()
    expect(screen.queryByText('Sammanfattning')).not.toBeInTheDocument()
    await unlock()
    expect(screen.getByText('Sammanfattning')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Lås och gå tillbaka' }))
    expect(screen.getByText('Hemskärm')).toBeInTheDocument()
  })

  it('toggles free play', async () => {
    setup('1234')
    await unlock()
    await userEvent.click(screen.getByLabelText(/Fri lek/))
    expect(getState().settings.freePlayEnabled).toBe(true)
  })

  it('writes manual level and lock', async () => {
    setup('1234')
    await unlock()
    await userEvent.selectOptions(screen.getByLabelText('Nivå för Ord'), '3')
    await userEvent.click(screen.getByLabelText('Lås nivån för Ord'))
    expect(getState().progress['read.words']).toMatchObject({ level: 3, levelLocked: true })
  })

  it('reset clears missions but keeps the PIN', async () => {
    setup('1234')
    actions.completeSession({ at: 1, area: 'stationen', skills: [], firstTry: 1, total: 1 })
    await unlock()
    await userEvent.click(screen.getByRole('button', { name: 'Nollställ framsteg' }))
    await userEvent.click(screen.getByRole('button', { name: 'Ja, nollställ' }))
    expect(getState().missions.stationen).toBe(0)
    expect(getState().parentPin).toBe('1234')
  })

  it('keeps the gate on a wrong adult-check answer', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0) // 10 + 10
    setup()
    await userEvent.type(screen.getByLabelText(/Skriv svaret/), '21')
    await userEvent.click(screen.getByRole('button', { name: 'Fortsätt' }))
    expect(screen.getByText('Det blev inte rätt. Försök igen.')).toBeInTheDocument()
    expect(screen.queryByText('Sammanfattning')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Välj en kod med 4 siffror')).not.toBeInTheDocument()
  })

  it('does not save a mismatched confirm PIN', async () => {
    setup()
    await solveCheck()
    await typePin('Välj en kod med 4 siffror', '4321', 'Nästa')
    await typePin('Skriv koden en gång till', '1111', 'Spara koden')
    expect(screen.getByText('Koderna var olika. Försök igen.')).toBeInTheDocument()
    expect(getState().parentPin).toBeUndefined()
  })

  it('rejects a PIN that is not 4 digits', async () => {
    setup()
    await solveCheck()
    await userEvent.type(screen.getByLabelText('Välj en kod med 4 siffror'), '12a3')
    expect(screen.getByRole('button', { name: 'Nästa' })).toBeDisabled()
    expect(screen.queryByText('Skriv koden en gång till')).not.toBeInTheDocument()
    expect(getState().parentPin).toBeUndefined()
  })

  it('"Glömt koden?" lets an adult overwrite the old PIN', async () => {
    setup('1234')
    await userEvent.click(screen.getByRole('button', { name: 'Glömt koden?' }))
    await solveCheck()
    await typePin('Välj en kod med 4 siffror', '5678', 'Nästa')
    await typePin('Skriv koden en gång till', '5678', 'Spara koden')
    expect(getState().parentPin).toBe('5678')
  })

  it('requires the PIN again after locking', async () => {
    const router = setup('1234')
    await unlock()
    await userEvent.click(screen.getByRole('button', { name: 'Lås och gå tillbaka' }))
    await act(() => router.navigate('/vuxen'))
    expect(await screen.findByLabelText('Skriv din kod')).toBeInTheDocument()
    expect(screen.queryByText('Sammanfattning')).not.toBeInTheDocument()
  })

  it('says too little data for a skill with 2 attempts', async () => {
    setup('1234')
    actions._replace({
      ...getState(),
      progress: { 'read.words': { level: 1, attempts: 2, firstTry: 2, hintsUsed: 0, recent: ['first', 'first'] } },
    })
    await unlock()
    const row = screen.getByLabelText('Nivå för Ord').closest('tr')
    expect(row).toHaveTextContent('ny – för lite data än')
  })

  it('shows the English summary only with enough data', async () => {
    const withColors = (attempts: number) =>
      actions._replace({
        ...getState(),
        progress: { 'en.colors': { level: 1, attempts, firstTry: attempts, hintsUsed: 0, recent: ['first', 'first'] } },
      })
    setup('1234')
    withColors(2)
    await unlock()
    expect(screen.queryByText('Engelska just nu')).not.toBeInTheDocument()
    cleanup()
    setup('1234')
    withColors(4)
    await unlock()
    expect(screen.getByText('Engelska just nu')).toBeInTheDocument()
    expect(screen.getByText('Förstår färger på engelska')).toBeInTheDocument()
  })
})
