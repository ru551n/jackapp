import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Question } from '../../core/types'
import { Exercise, REVEAL_AFTER } from './Exercise'

const question: Question = {
  id: 'math.count.test:3',
  skill: 'math.count',
  level: 1,
  theme: 'metro',
  prompt: 'Hur många vagnar har tåget?',
  task: {
    kind: 'choice',
    choices: ['2', '3', '4'].map((id) => ({ id, label: id })),
    answer: '3',
  },
  hints: [{ text: 'Räkna en vagn i taget.' }, { text: 'Det är fler än två.', eliminate: ['2'] }],
  success: 'Ja! Tre vagnar.',
}

describe('Exercise', () => {
  it('accepts a correct first answer and reports zero misses', async () => {
    const onDone = vi.fn()
    render(<Exercise question={question} onDone={onDone} nextLabel="Nästa" />)
    await userEvent.click(screen.getByRole('button', { name: '3' }))
    expect(screen.getByText('Ja! Tre vagnar.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Nästa' }))
    expect(onDone).toHaveBeenCalledWith(0, 0)
  })

  it('responds to a wrong answer calmly with a hint, never "fel"', async () => {
    render(<Exercise question={question} onDone={vi.fn()} nextLabel="Nästa" />)
    await userEvent.click(screen.getByRole('button', { name: '4' }))
    expect(screen.getByText('Prova igen')).toBeInTheDocument()
    expect(screen.getByText('Räkna en vagn i taget.')).toBeInTheDocument()
    expect(document.body.textContent?.toLowerCase()).not.toMatch(/\bfel\b/)
    expect(screen.getByRole('button', { name: '4' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('escalates hints, eliminates choices and finally reveals the answer', async () => {
    const onDone = vi.fn()
    render(<Exercise question={question} onDone={onDone} nextLabel="Nästa" />)
    await userEvent.click(screen.getByRole('button', { name: '4' }))
    await userEvent.click(screen.getByRole('button', { name: '2' }))
    expect(screen.getByText('Det är fler än två.')).toBeInTheDocument()
    // Further taps on dimmed choices do nothing.
    await userEvent.click(screen.getByRole('button', { name: '2' }))
    expect(screen.queryByText('Titta, den här är rätt. Tryck på den.')).not.toBeInTheDocument()
    expect(REVEAL_AFTER).toBe(3)
    await userEvent.click(screen.getByRole('button', { name: '3' }))
    await userEvent.click(screen.getByRole('button', { name: 'Nästa' }))
    expect(onDone).toHaveBeenCalledWith(2, 2)
  })

  it('supports order tasks step by step', async () => {
    const onDone = vi.fn()
    const order: Question = {
      ...question,
      id: 'logic.order.test',
      skill: 'logic.order',
      task: {
        kind: 'order',
        items: ['b', 'a', 'c'].map((id) => ({ id, label: id.toUpperCase() })),
        answer: ['a', 'b', 'c'],
      },
    }
    render(<Exercise question={order} onDone={onDone} nextLabel="Klart" />)
    await userEvent.click(screen.getByRole('button', { name: 'B' }))
    expect(screen.getByText('Prova igen')).toBeInTheDocument()
    for (const name of ['A', 'B', 'C']) await userEvent.click(screen.getByRole('button', { name }))
    await userEvent.click(screen.getByRole('button', { name: 'Klart' }))
    expect(onDone).toHaveBeenCalledWith(1, 1)
  })
})
