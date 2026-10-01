import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ItemInput } from './ItemInput'
import { Markdown } from './Markdown'
import { initialValue, isAnswered, type PublicItem } from './presentation'

/** Controlled wrapper that reports every value. */
function Harness({
  item,
  onValue,
  tap,
}: {
  item: PublicItem
  onValue: (v: unknown, now?: boolean) => void
  tap?: boolean
}) {
  const [v, setV] = useState(initialValue(item))
  return (
    <ItemInput
      item={item}
      value={v}
      tapToAnswer={tap}
      onChange={(x, now) => {
        setV(x)
        onValue(x, now)
      }}
    />
  )
}
const item = (p: Partial<PublicItem> & Pick<PublicItem, 'kind'>): PublicItem => ({ id: 'i1', prompt: 'Fråga', ...p })
const last = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)

describe('Markdown', () => {
  it('renders the subset and escapes HTML and script', () => {
    const { container } = render(
      <Markdown
        text={
          '# Rubrik\n\nHej **fet** och *kursiv* <script>alert(1)</script>\n\n- ett\n- <img src=x onerror=alert(1)>\n\n1. först'
        }
      />,
    )
    expect(container.querySelector('h3')).toHaveTextContent('Rubrik')
    expect(container.querySelector('strong')).toHaveTextContent('fet')
    expect(container.querySelector('em')).toHaveTextContent('kursiv')
    expect(container.querySelectorAll('ul li')).toHaveLength(2)
    expect(container.querySelector('ol li')).toHaveTextContent('först')
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<script>alert(1)</script>')
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
  })
})

describe('ItemInput', () => {
  it('multipleChoice: picks one; tap mode asks to submit at once', async () => {
    const on = vi.fn()
    const it1 = item({
      kind: 'multipleChoice',
      choices: [
        { id: 'a', text: 'Ett' },
        { id: 'b', text: 'Två' },
      ],
    })
    render(<Harness item={it1} onValue={on} tap />)
    await userEvent.click(screen.getByRole('button', { name: 'Två' }))
    expect(last(on)).toEqual(['b', true])
    expect(screen.getByRole('button', { name: 'Två' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('multiSelect: toggles several with the keyboard', async () => {
    const on = vi.fn()
    render(
      <Harness
        item={item({
          kind: 'multiSelect',
          choices: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
        })}
        onValue={on}
      />,
    )
    await userEvent.tab()
    await userEvent.keyboard('{Enter}')
    await userEvent.tab()
    await userEvent.keyboard(' ')
    expect(last(on)![0]).toEqual(['a', 'b'])
    await userEvent.keyboard(' ')
    expect(last(on)![0]).toEqual(['a'])
  })

  it('trueFalse: answers with a boolean', async () => {
    const on = vi.fn()
    render(<Harness item={item({ kind: 'trueFalse' })} onValue={on} />)
    await userEvent.click(screen.getByRole('button', { name: 'Falskt' }))
    expect(last(on)![0]).toBe(false)
  })

  it('fillBlank: one inline input per blank, in order', async () => {
    const on = vi.fn()
    render(<Harness item={item({ kind: 'fillBlank', text: 'Jag ___ en ___.', blankCount: 2 })} onValue={on} />)
    await userEvent.type(screen.getByLabelText('Lucka 1 av 2'), 'har')
    await userEvent.type(screen.getByLabelText('Lucka 2 av 2'), 'katt')
    expect(last(on)![0]).toEqual(['har', 'katt'])
  })

  it('matching: keyboard only, with native selects in left order', async () => {
    const on = vi.fn()
    render(<Harness item={item({ kind: 'matching', left: ['dog', 'cat'], right: ['katt', 'hund'] })} onValue={on} />)
    const dog = screen.getByLabelText('dog')
    dog.focus()
    await userEvent.selectOptions(dog, 'hund')
    await userEvent.tab()
    expect(screen.getByLabelText('cat')).toHaveFocus()
    await userEvent.selectOptions(screen.getByLabelText('cat'), 'katt')
    expect(last(on)![0]).toEqual(['hund', 'katt'])
  })

  it('ordering: up/down buttons work from the keyboard and announce the move', async () => {
    const on = vi.fn()
    const items = [
      { id: 'c', text: 'Tre' },
      { id: 'a', text: 'Ett' },
      { id: 'b', text: 'Två' },
    ]
    render(<Harness item={item({ kind: 'ordering', items })} onValue={on} />)
    screen.getByRole('button', { name: 'Flytta ner Tre' }).focus()
    await userEvent.keyboard('{Enter}')
    screen.getByRole('button', { name: 'Flytta ner Tre' }).focus()
    await userEvent.keyboard(' ')
    expect(last(on)![0]).toEqual(['a', 'b', 'c'])
    expect(screen.getByText('Tre är nu på plats 3 av 3.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Flytta upp Ett' })).toBeDisabled()
  })

  it('numeric: free text with comma decimals and unit', async () => {
    const on = vi.fn()
    render(<Harness item={item({ kind: 'numeric', unit: 'cm' })} onValue={on} />)
    const input = screen.getByLabelText('Ditt svar i cm')
    expect(input).toHaveAttribute('inputmode', 'decimal')
    await userEvent.type(input, '3,5')
    expect(last(on)![0]).toBe('3,5')
    expect(isAnswered(item({ kind: 'numeric' }), '3,5')).toBe(true)
  })

  it('freeText: textarea value as { text }', async () => {
    const on = vi.fn()
    render(<Harness item={item({ kind: 'freeText' })} onValue={on} />)
    await userEvent.type(screen.getByLabelText('Ditt svar'), 'Hej')
    expect(last(on)![0]).toEqual({ text: 'Hej' })
  })

  it('flashcard: flips, then rates and submits', async () => {
    const on = vi.fn()
    render(<Harness item={item({ kind: 'flashcard', prompt: 'dog', back: 'hund' })} onValue={on} />)
    expect(screen.queryByText('hund')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /vända kortet/ }))
    expect(screen.getByText('hund')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delvis' }))
    expect(last(on)).toEqual(['partly', true])
  })
})
