import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { AdultArea } from './AdultArea'
import { mockApi } from './test-api'

afterEach(() => vi.unstubAllGlobals())

it('credits the voices and links the third-party notices from the overview', async () => {
  mockApi({
    'GET /gate': { pinSet: true, adult: true },
    'GET /learners': [],
    'GET /system/status': { ready: true, capabilities: [], features: {}, limits: {} },
  })
  const router = createMemoryRouter([{ path: '/vuxen/*', element: <AdultArea /> }], { initialEntries: ['/vuxen'] })
  render(<RouterProvider router={router} />)
  await userEvent.click(await screen.findByRole('link', { name: /Om appen/ }))
  expect(await screen.findByText(/Svensk röst: Alma av Daniel Nylander/)).toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: 'https://huggingface.co/yeagersthlm/piper-voice-sv-alma' }),
  ).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'CC BY 4.0' })).toBeInTheDocument()
  expect(screen.getByText(/Bryce Beattie/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'tredjepartsmeddelanden' })).toHaveAttribute(
    'href',
    'THIRD_PARTY_NOTICES.txt',
  )
})
