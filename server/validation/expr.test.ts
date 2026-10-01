import { describe, expect, it } from 'vitest'
import { approxEqual, evaluate, promptExpression } from './expr'

describe('evaluate', () => {
  it.each([
    ['7*8', 56],
    ['7 × 8', 56],
    ['7·8', 56],
    ['2+3*4', 14],
    ['(2+3)*4', 20],
    ['10-4-3', 3],
    ['100/10/5', 2],
    ['2^3^2', 512],
    ['2**3', 8],
    ['-2^2', -4],
    ['(-2)^2', 4],
    ['2^-1', 0.5],
    ['--3', 3],
    ['+5', 5],
    ['3²', 9],
    ['2³+1', 9],
    ['3,5 + 1,5', 5],
    ['0.1+0.2', 0.30000000000000004],
    ['.5*4', 2],
    [',5*4', 2],
    ['3/4', 0.75],
    ['(3/4)*12', 9],
    ['½ + ¼', 0.75],
    ['2½ * 2', 5],
    ['50%', 0.5],
    ['20% * 50', 10],
    ['200 * 5 %', 10],
    ['sqrt(16)', 4],
    ['SQRT(2)^2', 2.0000000000000004],
    ['√9 + 1', 4],
    ['√(9+16)', 5],
    ['abs(3-10)', 7],
    ['12 ÷ 4', 3],
    ['12 / 4', 3],
    ['8 − 3', 5],
    ['8 – 3', 5],
    ['1 000 + 1', 1001],
    ['12 345,5 * 2', 24691],
    ['0/5', 0],
    ['((((1))))', 1],
  ])('%s = %d', (src, value) => {
    const r = evaluate(src)
    expect(r.ok).toBe(true)
    if (r.ok) expect(approxEqual(r.value, value)).toBe(true)
  })

  it.each([
    ['', 'tomt'],
    ['   ', 'tomt'],
    ['1/0', 'division med noll'],
    ['5/(2-2)', 'division med noll'],
    ['1+', 'slut'],
    ['(1+2', 'parentes'],
    ['1+2)', 'oväntat'],
    ['2 3', 'oväntat'],
    ['3,5,1', 'oväntat'],
    ['*3', 'oväntat'],
    ['x+1', 'okänt namn'],
    ['7 x 8', 'okänt namn'],
    ['alert(1)', 'okänt namn'],
    ['process.exit()', 'okänt namn'],
    ['constructor', 'okänt namn'],
    ['__proto__', 'otillåtet'],
    ['Math.max(1,2)', 'okänt namn'],
    ['1; 2', 'otillåtet'],
    ['`1`', 'otillåtet'],
    ['1 == 1', 'otillåtet'],
    ['sqrt(-1)', 'inte definierad'],
    ['(-8)^(1/3)', 'ogiltig potens'],
    ['10^400', 'ogiltig potens'],
    ['0^-1', 'ogiltig potens'],
    ['sqrt', 'slut'],
    ['('.repeat(60) + '1' + ')'.repeat(60), 'nästling'],
    ['-'.repeat(60) + '1', 'nästling'],
    ['1+'.repeat(160) + '1', 'för långt'],
  ])('rejects %j', (src, error) => {
    const r = evaluate(src)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain(error)
  })

  it('never returns -0', () => {
    expect(evaluate('-0')).toEqual({ ok: true, value: 0 })
  })
})

describe('approxEqual', () => {
  it.each([
    [0.1 + 0.2, 0.3, 0, true],
    [56, 56, 0, true],
    [56, 57, 0, false],
    [3.14, 3.14159, 0.01, true],
    [3.1, 3.14159, 0.01, false],
    [1e12, 1e12 + 1, 0, true],
  ])('%d ≈ %d (±%d) → %s', (a, b, t, want) => expect(approxEqual(a, b, t)).toBe(want))
})

describe('promptExpression', () => {
  it.each([
    ['Vad är 7 × 8?', 56],
    ['vad blir 12 - 5?', 7],
    ['Räkna ut 3,5 + 2', 5.5],
    ['Beräkna: (2+3)·4', 20],
    ['12 − 5 = ?', 7],
    ['12 − 5 = ___', 7],
    ['7 x 8 =', 56],
    ['Vad är 20 % av 50?', 10],
    ['Vad är 3/4 av 12?', 9],
    ['What is 6 * 7?', 42],
    ['Hur mycket är 100 ÷ 4?', 25],
    ['-3 + 5', 2],
  ])('%j → %d', (prompt, value) => {
    const e = promptExpression(prompt)
    expect(e).toBeDefined()
    const r = evaluate(e!)
    expect(r.ok && approxEqual(r.value, value)).toBe(true)
  })

  it.each([
    'Lisa har 3 äpplen och får 4 till. Hur många har hon?',
    'Vad är 7?',
    'Vilket tal är störst?',
    'Vad är 1/0?',
    'Vad är x + 2?',
    'Klockan är 12:30',
  ])('ignores %j', (prompt) => expect(promptExpression(prompt)).toBeUndefined())
})
