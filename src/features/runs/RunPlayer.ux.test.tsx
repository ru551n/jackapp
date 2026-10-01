import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ItemInput } from './ItemInput'
import { initialValue, type PublicItem } from './presentation'
import { RunPlayer } from './RunPlayer'
import { hasFel, mockApi } from './testApi'

// Speech is unavailable in jsdom; pretend a voice exists so "Lyssna" buttons render.
vi.mock('../../lib/speech', () => ({ canSpeak: () => true, speak: vi.fn(), useSpeechReady: () => 0 }))

const L = 'l1'
const ART = 'a1'
const RUN = 'r1'
const R = `/learners/${L}/runs`
const base = { lang: 'sv', media: [], skills: ['s'], difficulty: 2, hintCount: 1 }
const mc = (id: string, prompt: string) => ({
  ...base,
  id,
  kind: 'multipleChoice',
  prompt,
  choices: [
    { id: 'a', text: '3' },
    { id: 'b', text: '4' },
  ],
})
const runView = (items: unknown[]) => ({
  id: RUN,
  learnerId: L,
  artifactId: ART,
  artifactVersion: 1,
  title: 'Addition',
  mode: 'test',
  feedback: 'immediate',
  state: 'active',
  startedAt: '',
  finishedAt: null,
  items,
  progress: {},
  summary: null,
})
const retry = (itemId: string) => ({
  itemId,
  attempt: 1,
  correct: false,
  score: 0,
  message: 'Nästan! Prova igen.',
  hint: 'Räkna på fingrarna.',
  done: false,
  revealed: false,
})
const summary = {
  answered: 0,
  total: 1,
  correct: 0,
  message: 'Du kan fortsätta öva när du vill.',
  skills: [{ skill: 'math.add', correct: 0, total: 1, note: 'Värt att öva lite mer på.' }],
  review: [],
  selfAssess: [],
}

afterEach(() => vi.unstubAllGlobals())

describe('RunPlayer UX', () => {
  it('after a miss: "Svara" is the only main button, "Hoppa över" is quiet, and the hint can be heard', async () => {
    mockApi({
      [`POST ${R}`]: runView([mc('i1', 'Vad är 2 + 2?'), mc('i2', 'Vad är 1 + 3?')]),
      [`POST ${R}/${RUN}/answers`]: retry('i1'),
    })
    render(<RunPlayer learnerId={L} variant="middle" artifactId={ART} />)
    await userEvent.click(await screen.findByRole('button', { name: '3' }))
    await userEvent.click(screen.getByRole('button', { name: 'Svara' }))
    expect(await screen.findAllByText('Räkna på fingrarna.')).not.toHaveLength(0)
    expect(screen.queryByRole('button', { name: /Nästa/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Hoppa över' })).toBeInTheDocument()
    // Prompt plus the hint box: both can be listened to.
    expect(screen.getAllByRole('button', { name: 'Lyssna' })).toHaveLength(2)
    expect(hasFel()).toBe(false)
  })

  it('last item: "Hoppa över" (not "Avsluta") goes to the results, which end with "Klar – till start"', async () => {
    const onDone = vi.fn()
    mockApi({ [`POST ${R}`]: runView([mc('i1', 'Vad är 2 + 2?')]), [`POST ${R}/${RUN}/finish`]: summary })
    render(<RunPlayer learnerId={L} variant="middle" artifactId={ART} onDone={onDone} />)
    await screen.findByRole('heading', { name: 'Vad är 2 + 2?' })
    expect(screen.queryByRole('button', { name: 'Avsluta' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Hoppa över' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Klar – till start' }))
    expect(onDone).toHaveBeenCalled()
    // The skill slug never shows; only the server's note.
    expect(screen.queryByText(/math\.add/)).toBeNull()
  })

  it('early band and minimal text: no "Uppgift 1 av" line, the progress bar stays', async () => {
    mockApi({ [`POST ${R}`]: runView([mc('i1', 'Vad är 2 + 2?')]) })
    render(<RunPlayer learnerId={L} variant="early" artifactId={ART} />)
    await screen.findByRole('heading', { name: 'Vad är 2 + 2?' })
    expect(screen.queryByText(/Uppgift 1 av 1/)).toBeNull()
    expect(screen.getByRole('progressbar', { name: 'Uppgift 1 av 1' })).toBeInTheDocument()
  })

  it('step by step: only the answer first; skip and hint come after a try', async () => {
    mockApi({ [`POST ${R}`]: runView([mc('i1', 'Vad är 2 + 2?')]), [`POST ${R}/${RUN}/answers`]: retry('i1') })
    render(<RunPlayer learnerId={L} variant="middle" artifactId={ART} presentation={{ stepByStep: true }} />)
    await userEvent.click(await screen.findByRole('button', { name: '3' }))
    expect(screen.queryByRole('button', { name: 'Hoppa över' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Ledtråd' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Svara' }))
    expect(await screen.findByRole('button', { name: 'Hoppa över' })).toBeInTheDocument()
  })
})

function Harness({ item, onValue }: { item: PublicItem; onValue: (v: unknown) => void }) {
  const [v, setV] = useState(initialValue(item))
  return (
    <ItemInput
      item={item}
      value={v}
      pairTiles
      brief
      onChange={(x) => {
        setV(x)
        onValue(x)
      }}
    />
  )
}

describe('ItemInput, early band', () => {
  const matching: PublicItem = {
    id: 'm1',
    kind: 'matching',
    prompt: 'Para ihop',
    left: ['4 + 13', '9 + 13'],
    right: ['22', '17'],
  }

  it('matching: tap a left tile, then a right tile; tapping a pair undoes it', async () => {
    const on = vi.fn()
    render(<Harness item={matching} onValue={on} />)
    expect(screen.queryByRole('combobox')).toBeNull()
    const left = screen.getByRole('button', { name: '4 + 13' })
    await userEvent.click(left)
    expect(left).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/4 \+ 13 är vald/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '17' }))
    expect(on).toHaveBeenLastCalledWith(['17', ''])
    expect(screen.getByText('4 + 13 och 17 hör ihop.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '4 + 13, ihop med 17' })).toBeInTheDocument()
    // Both tiles carry the same number badge.
    expect(within(screen.getByRole('button', { name: '17, ihop med 4 + 13' })).getByText('1')).toBeInTheDocument()

    // Keyboard works too: pair the second, then undo the first from its right tile.
    screen.getByRole('button', { name: '9 + 13' }).focus()
    await userEvent.keyboard('{Enter}')
    screen.getByRole('button', { name: '22' }).focus()
    await userEvent.keyboard(' ')
    expect(on).toHaveBeenLastCalledWith(['17', '22'])
    await userEvent.click(screen.getByRole('button', { name: '17, ihop med 4 + 13' }))
    await waitFor(() => expect(on).toHaveBeenLastCalledWith(['', '22']))
  })

  it('numeric: the decimal-comma note is left out with brief text', () => {
    render(<Harness item={{ id: 'n1', kind: 'numeric', prompt: 'Hur många?' }} onValue={vi.fn()} />)
    expect(screen.queryByText(/decimaler med komma/)).toBeNull()
  })
})
