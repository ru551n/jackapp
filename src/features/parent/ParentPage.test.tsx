import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
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
  return render(<RouterProvider router={router} />)
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
    expect(screen.getByText('Fel kod. Försök igen.')).toBeInTheDocument()
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
})
