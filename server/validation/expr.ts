// Safe arithmetic evaluator: a tiny recursive-descent parser. No eval/Function, no identifiers
// except a fixed function whitelist. Grammar: docs/platform/validation.md#evaluator

export type EvalResult = { ok: true; value: number } | { ok: false; error: string }

const MAX_LEN = 300
const MAX_DEPTH = 40
const MAX_TOKENS = 200

type Tok = { t: 'num'; v: number } | { t: 'op'; v: string } | { t: 'fn'; v: string }

const OPS: Record<string, string> = {
  '+': '+',
  '-': '-',
  '−': '-',
  '–': '-',
  '*': '*',
  '×': '*',
  '·': '*',
  '⋅': '*',
  '/': '/',
  '÷': '/',
  '∕': '/',
  '^': '^',
  '(': '(',
  ')': ')',
  '%': '%',
  '√': 'sqrt',
}
const VULGAR: Record<string, number> = {
  '½': 1 / 2,
  '¼': 1 / 4,
  '¾': 3 / 4,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅕': 1 / 5,
  '⅛': 1 / 8,
}
const SUPER: Record<string, number> = { '²': 2, '³': 3 }
const FUNCS: Record<string, (x: number) => number> = { sqrt: Math.sqrt, abs: Math.abs }

class EvalError extends Error {}

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    if (/\s/.test(c)) {
      i++
      continue
    }
    const rest = src.slice(i)
    // Integer (optionally space-grouped thousands, "1 000"), then optional comma/dot decimals.
    const num = /^(?:\d{1,3}(?:[   ]\d{3})+(?!\d)|\d+)(?:[.,]\d+)?|^[.,]\d+/.exec(rest)
    if (num) {
      out.push({ t: 'num', v: Number(num[0].replace(/[   ]/g, '').replace(',', '.')) })
      i += num[0].length
      continue
    }
    if (rest.startsWith('**')) {
      out.push({ t: 'op', v: '^' })
      i += 2
      continue
    }
    if (Object.hasOwn(SUPER, c)) {
      out.push({ t: 'op', v: '^' }, { t: 'num', v: SUPER[c]! })
      i++
      continue
    }
    if (Object.hasOwn(VULGAR, c)) {
      const prev = out.at(-1)
      if (prev?.t === 'num')
        prev.v += VULGAR[c]! // mixed number "2½"
      else out.push({ t: 'num', v: VULGAR[c]! })
      i++
      continue
    }
    const op = Object.hasOwn(OPS, c) ? OPS[c] : undefined
    if (op) {
      out.push(op === 'sqrt' ? { t: 'fn', v: op } : { t: 'op', v: op })
      i++
      continue
    }
    const id = /^\p{L}+/u.exec(rest)
    if (id) {
      const name = id[0].toLowerCase()
      if (!Object.hasOwn(FUNCS, name)) throw new EvalError(`okänt namn "${id[0].slice(0, 20)}"`)
      out.push({ t: 'fn', v: name })
      i += id[0].length
      continue
    }
    throw new EvalError(`otillåtet tecken "${c}"`)
  }
  if (out.length > MAX_TOKENS) throw new EvalError('uttrycket är för långt')
  return out
}

class Parser {
  private i = 0
  private depth = 0
  private readonly toks: Tok[]
  constructor(toks: Tok[]) {
    this.toks = toks
  }

  parse(): number {
    if (!this.toks.length) throw new EvalError('tomt uttryck')
    const v = this.expr()
    if (this.i < this.toks.length) throw new EvalError('oväntat tecken efter uttrycket')
    return v
  }

  private isOp(...v: string[]): boolean {
    const t = this.toks[this.i]
    return t?.t === 'op' && v.includes(t.v)
  }

  private take(): Tok {
    const t = this.toks[this.i++]
    if (!t) throw new EvalError('uttrycket tar slut för tidigt')
    return t
  }

  private nest<T>(f: () => T): T {
    if (++this.depth > MAX_DEPTH) throw new EvalError('för djup nästling')
    try {
      return f()
    } finally {
      this.depth--
    }
  }

  // expr := term (("+" | "-") term)*
  private expr(): number {
    return this.nest(() => {
      let v = this.term()
      while (this.isOp('+', '-')) v = this.take().v === '+' ? v + this.term() : v - this.term()
      return v
    })
  }

  // term := unary (("*" | "/") unary)*
  private term(): number {
    let v = this.unary()
    while (this.isOp('*', '/')) {
      const op = this.take().v
      const r = this.unary()
      if (op === '*') v *= r
      else if (r === 0) throw new EvalError('division med noll')
      else v /= r
    }
    return v
  }

  // unary := ("+" | "-") unary | power
  private unary(): number {
    if (this.isOp('+', '-')) {
      const neg = this.take().v === '-'
      return this.nest(() => (neg ? -this.unary() : this.unary()))
    }
    return this.power()
  }

  // power := postfix ("^" unary)?   (right-associative, so -2^2 = -4 and 2^3^2 = 512)
  private power(): number {
    const b = this.postfix()
    if (!this.isOp('^')) return b
    this.take()
    const v = b ** this.unary()
    if (!Number.isFinite(v)) throw new EvalError('ogiltig potens')
    return v
  }

  // postfix := primary "%"*
  private postfix(): number {
    let v = this.primary()
    while (this.isOp('%')) {
      this.take()
      v /= 100
    }
    return v
  }

  // primary := number | "(" expr ")" | fn primary
  private primary(): number {
    const t = this.take()
    if (t.t === 'num') return t.v
    if (t.t === 'fn') {
      const v = this.nest(() => FUNCS[t.v]!(this.postfix()))
      if (!Number.isFinite(v)) throw new EvalError(`${t.v} är inte definierad här`)
      return v
    }
    if (t.v === '(') {
      const v = this.expr()
      if (!this.isOp(')')) throw new EvalError('parentes saknas')
      this.take()
      return v
    }
    throw new EvalError(`oväntat "${t.v}"`)
  }
}

/** Evaluate an arithmetic expression. Never throws. */
export function evaluate(src: string): EvalResult {
  try {
    if (src.length > MAX_LEN) throw new EvalError('uttrycket är för långt')
    const value = new Parser(tokenize(src)).parse()
    if (!Number.isFinite(value)) throw new EvalError('resultatet är inte ett ändligt tal')
    return { ok: true, value: Object.is(value, -0) ? 0 : value }
  } catch (e) {
    if (e instanceof EvalError) return { ok: false, error: e.message }
    throw e
  }
}

/** Numeric equality with an absolute tolerance plus a tiny relative epsilon for float noise. */
export function approxEqual(a: number, b: number, tolerance = 0): boolean {
  return Math.abs(a - b) <= tolerance + 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
}

const LEAD =
  /^(?:vad\s+(?:är|blir)|hur\s+mycket\s+(?:är|blir)|räkna(?:\s+ut)?|beräkna|what\s+is|calculate|work\s+out|compute)\s*:?\s*/i

/**
 * The expression in a prompt that is nothing but an arithmetic question, e.g. "Vad är 7 × 8?",
 * "12 − 5 = ?", "Räkna ut 20 % av 50", "Vad är 3/4 av 12?". Word problems return undefined (deliberately not guessed).
 */
export function promptExpression(prompt: string): string | undefined {
  const s = prompt
    .trim()
    .replace(LEAD, '')
    .replace(/\s*=\s*(?:\?|_+)?\s*[?!.]*\s*$/, '')
    .replace(/[?!.:]+$/, '')
    .replace(/([\d%½¼¾)])\s*(?:av|of)\s+/gi, '$1 * ')
    .replace(/(\d)\s*[xX]\s*(?=[\d(])/g, '$1*')
    .trim()
  if (!/\d/.test(s) || /\p{L}/u.test(s.replace(/sqrt|abs/gi, ''))) return undefined
  if (!/[+\-−–*×·⋅/÷^%√²³]/.test(s.replace(/^[-−–]/, ''))) return undefined
  return evaluate(s).ok ? s : undefined
}
