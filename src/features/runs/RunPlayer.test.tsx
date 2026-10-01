import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RunPlayer } from './RunPlayer'
import { RunHistory } from './RunHistory'
import { hasFel, mockApi } from './testApi'

const L = 'l1'
const ART = 'a1'
const RUN = 'r1'
const R = `/learners/${L}/runs`
const base = { lang: 'sv', media: [], skills: ['s'], difficulty: 2, hintCount: 1 }
const mc = {
  ...base,
  id: 'i1',
  kind: 'multipleChoice',
  prompt: 'Vad är 2 + 2?',
  choices: [
    { id: 'a', text: '3' },
    { id: 'b', text: '4' },
  ],
}
const free = { ...base, id: 'i2', kind: 'freeText', prompt: 'Förklara addition.', hintCount: 0 }
const runView = (feedback: 'immediate' | 'end', items: unknown[] = [mc, free]) => ({
  id: RUN,
  learnerId: L,
  artifactId: ART,
  artifactVersion: 1,
  title: 'Matte',
  mode: 'test',
  feedback,
  state: 'active',
  startedAt: '',
  finishedAt: null,
  items,
  progress: {},
  summary: null,
})
const summary = {
  answered: 2,
  total: 2,
  correct: 1,
  message: 'Du klarade 1 av 2. Bra kämpat!',
  skills: [{ skill: 'math.add', label: 'addition', correct: 1, total: 2, note: 'Öva lite mer på addition.' }],
  review: [{ itemId: 'i1', prompt: 'Vad är 2 + 2?', solution: '4', explanation: 'Två och två är **fyra**.' }],
  selfAssess: [],
}
const sections = [
  { kind: 'intro', title: 'Start', body: 'Läs **noga**.', items: [] },
  { kind: 'check', items: [{ id: 'i1' }, { id: 'i2' }] },
]

afterEach(() => vi.unstubAllGlobals())

describe('RunPlayer', () => {
  it('immediate feedback: calm retry with hint, then solution and results', async () => {
    let tries = 0
    const calls = mockApi({
      [`POST ${R}`]: runView('immediate'),
      [`GET /artifacts/${ART}`]: { artifact: { sections } },
      [`POST ${R}/${RUN}/answers`]: (b: unknown) => {
        const { itemId, attempt, answer } = b as { itemId: string; attempt: number; answer: unknown }
        if (itemId === 'i1' && ++tries === 1)
          return {
            itemId,
            attempt,
            correct: false,
            score: 0,
            message: 'Prova igen.',
            hint: 'Räkna på fingrarna.',
            done: false,
            revealed: false,
          }
        if (itemId === 'i2')
          return {
            itemId,
            attempt,
            correct: true,
            score: 1,
            message: 'Bra förklarat!',
            done: true,
            revealed: false,
            ai: { keyPointsMet: [0], feedback: 'Tydligt!', score: 1 },
          }
        return {
          itemId,
          attempt,
          correct: answer === 'b',
          score: 1,
          message: 'Rätt! Bra jobbat.',
          done: true,
          revealed: false,
          solution: '4',
          explanation: 'Två och två är **fyra**.',
        }
      },
      [`POST ${R}/${RUN}/finish`]: summary,
    })
    render(<RunPlayer learnerId={L} variant="middle" artifactId={ART} onPracticeMore={vi.fn()} />)
    // Section body first, rendered as markdown.
    expect(await screen.findByText('noga')).toHaveProperty('tagName', 'STRONG')
    await userEvent.click(screen.getByRole('button', { name: 'Fortsätt' }))

    await userEvent.click(screen.getByRole('button', { name: '3' }))
    await userEvent.click(screen.getByRole('button', { name: 'Svara' }))
    expect(await screen.findAllByText('Prova igen.')).not.toHaveLength(0)
    expect(screen.getAllByText('Räkna på fingrarna.').length).toBeGreaterThan(0)
    expect(hasFel()).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: '4' }))
    await userEvent.click(screen.getByRole('button', { name: 'Svara' }))
    expect(await screen.findByText('fyra')).toBeInTheDocument()
    expect(
      calls.filter((c) => c.path.endsWith('/answers')).map((c) => (c.body as { attempt: number }).attempt),
    ).toEqual([1, 2])

    await userEvent.click(screen.getByRole('button', { name: /Nästa/ }))
    await userEvent.type(screen.getByLabelText('Ditt svar'), 'Man lägger ihop.')
    await userEvent.click(screen.getByRole('button', { name: 'Svara' }))
    expect(await screen.findByText('Tydligt!')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Se resultat/ }))
    expect(await screen.findByRole('heading', { name: 'Du klarade 1 av 2' })).toBeInTheDocument()
    expect(screen.getByText('Bra kämpat!')).toBeInTheDocument()
    expect(screen.getByText('Öva lite mer på addition.')).toBeInTheDocument()
    // The server's Swedish label, never the tag.
    expect(screen.getByText('addition:')).toBeInTheDocument()
    expect(screen.queryByText(/math\.add/)).toBeNull()
    expect(hasFel()).toBe(false)
  })

  it('end mode: answers are saved quietly, results come at the end', async () => {
    const calls = mockApi({
      [`POST ${R}`]: runView('end'),
      [`GET /artifacts/${ART}`]: new Response('{}', { status: 404 }),
      [`POST ${R}/${RUN}/answers`]: (b: unknown) => ({
        itemId: (b as { itemId: string }).itemId,
        attempt: 1,
        correct: null,
        score: null,
        message: 'Svaret är sparat.',
        done: false,
        revealed: false,
      }),
      [`POST ${R}/${RUN}/finish`]: summary,
    })
    const onPracticeMore = vi.fn()
    render(<RunPlayer learnerId={L} variant="upper" artifactId={ART} onPracticeMore={onPracticeMore} />)
    await userEvent.click(await screen.findByRole('button', { name: '3' }))
    await userEvent.click(screen.getByRole('button', { name: 'Spara svar' }))
    // Moved on to the next item without revealing anything.
    expect(await screen.findByRole('heading', { name: 'Förklara addition.' })).toBeInTheDocument()
    expect(screen.getAllByText('Förra svaret är sparat.')).not.toHaveLength(0)
    expect(screen.queryByText('Prova igen.')).toBeNull()
    await userEvent.type(screen.getByLabelText('Ditt svar'), 'Plus.')
    await userEvent.click(screen.getByRole('button', { name: 'Spara svar' }))
    await userEvent.click(await screen.findByRole('button', { name: /Lämna in/ }))
    expect(await screen.findByText('fyra')).toBeInTheDocument()
    expect(calls.some((c) => c.path.endsWith('/finish'))).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: /Öva mer på det här/ }))
    expect(onPracticeMore).toHaveBeenCalledWith(['math.add'])
  })

  it('free text without AI: self-assessment with the rubric, resubmitted on the same attempt', async () => {
    const calls = mockApi({
      [`POST ${R}`]: runView('immediate', [free]),
      [`POST ${R}/${RUN}/answers`]: (b: unknown) => {
        const { answer } = b as { answer: { selfRating?: string } }
        return answer.selfRating
          ? {
              itemId: 'i2',
              attempt: 1,
              correct: false,
              score: 0.5,
              message: 'Bra att du tränar!',
              done: true,
              revealed: false,
            }
          : {
              itemId: 'i2',
              attempt: 1,
              correct: null,
              score: null,
              message: 'Jämför ditt svar med punkterna och bedöm själv.',
              done: false,
              revealed: false,
              selfAssess: { rubric: ['Nämner summa'], sampleAnswer: 'Man lägger ihop tal.' },
            }
      },
    })
    render(<RunPlayer learnerId={L} variant="middle" artifactId={ART} />)
    await userEvent.type(await screen.findByLabelText('Ditt svar'), 'Man räknar ihop.')
    await userEvent.click(screen.getByRole('button', { name: 'Svara' }))
    expect(await screen.findByText('Nämner summa')).toBeInTheDocument()
    expect(screen.getByText('Man lägger ihop tal.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delvis' }))
    expect(await screen.findAllByText('Bra att du tränar!')).not.toHaveLength(0)
    const answers = calls.filter((c) => c.path.endsWith('/answers')).map((c) => c.body)
    expect(answers[1]).toEqual({ itemId: 'i2', attempt: 1, answer: { text: 'Man räknar ihop.', selfRating: 'partly' } })
    expect(hasFel()).toBe(false)
  })

  it('renders licence attribution when required and labels AI images', async () => {
    const license = (l: string) => ({ license: l, provider: 'x', retrievedAt: '', autoUsable: true })
    const withMedia = {
      ...mc,
      media: [
        { assetId: 'img-cc', kind: 'image', alt: 'Ett blad', generated: false, license: license('CC-BY-4.0') },
        { assetId: 'img-ai', kind: 'image', alt: 'Ritad växt', generated: true, license: license('ai-generated') },
        { assetId: 'img-pd', kind: 'image', alt: 'Gammal karta', generated: false, license: license('PD') },
      ],
    }
    const calls = mockApi({
      [`POST ${R}`]: runView('immediate', [withMedia]),
      'GET /assets/img-cc/attribution': { attributionRequired: true, attribution: 'Foto: A. Svensson, CC BY 4.0' },
    })
    render(<RunPlayer learnerId={L} variant="middle" artifactId={ART} />)
    expect(await screen.findByText('Foto: A. Svensson, CC BY 4.0')).toBeInTheDocument()
    expect(screen.getByAltText('Ett blad')).toHaveAttribute('src', '/api/v1/assets/img-cc')
    expect(screen.getByText('AI-bild')).toBeInTheDocument()
    expect(screen.getAllByText('AI-bild')).toHaveLength(1)
    // No attribution lookups for public-domain or AI images.
    await waitFor(() =>
      expect(calls.filter((c) => c.path.includes('/attribution')).map((c) => c.path)).toEqual([
        '/assets/img-cc/attribution',
      ]),
    )
  })

  it('early band: tapping a tile answers at once', async () => {
    const calls = mockApi({
      [`POST ${R}`]: runView('immediate', [mc]),
      [`POST ${R}/${RUN}/answers`]: {
        itemId: 'i1',
        attempt: 1,
        correct: true,
        score: 1,
        message: 'Rätt! Bra jobbat.',
        done: true,
        revealed: false,
      },
    })
    render(<RunPlayer learnerId={L} variant="early" artifactId={ART} />)
    await userEvent.click(await screen.findByRole('button', { name: '4' }))
    expect(screen.queryByRole('button', { name: 'Svara' })).toBeNull()
    await waitFor(() => expect(calls.filter((c) => c.path.endsWith('/answers'))).toHaveLength(1))
    expect(await screen.findAllByText('Rätt! Bra jobbat.')).not.toHaveLength(0)
  })
})

describe('RunHistory', () => {
  it('lists attempts with choice text and marks AI assessments', async () => {
    mockApi({
      [`GET ${R}`]: [
        {
          id: RUN,
          artifactId: ART,
          artifactVersion: 1,
          feedback: 'immediate',
          state: 'finished',
          startedAt: '2026-10-01T10:00:00Z',
          finishedAt: null,
          summary,
          answers: [
            {
              itemId: 'i1',
              attempt: 1,
              answer: 'b',
              correct: true,
              score: 1,
              revealed: false,
              assessedBy: 'auto',
              at: '',
            },
            {
              itemId: 'i2',
              attempt: 1,
              answer: { text: 'Plus' },
              correct: true,
              score: 1,
              revealed: false,
              assessedBy: 'ai',
              at: '',
            },
          ],
        },
      ],
      [`GET /artifacts/${ART}`]: {
        artifact: { id: ART, title: 'Matte', sections: [{ items: [{ ...mc, answer: 'b' }, free] }] },
      },
    })
    render(<RunHistory learnerId={L} variant="adult" />)
    expect(await screen.findByText('AI-bedömd')).toBeInTheDocument()
    expect(await screen.findByText('Matte')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '4' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Plus' })).toBeInTheDocument()
  })
})
