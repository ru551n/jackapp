import type { ReactNode } from 'react'

// Tiny markdown subset for model-written section bodies: paragraphs, #-headings, - / 1. lists,
// **bold** and *italic*. Output is React elements only, so every character of model text is escaped.

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /\*\*(.+?)\*\*|\*(.+?)\*/g
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(m[1] !== undefined ? <strong key={m.index}>{m[1]}</strong> : <em key={m.index}>{m[2]}</em>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const BULLET = /^\s*[-*•]\s+/
const NUMBER = /^\s*\d+[.)]\s+/

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)
  return (
    <div className={className}>
      {blocks.map((block, i) => {
        const lines = block.split('\n').filter((l) => l.trim())
        if (!lines.length) return null
        const heading = /^(#{1,4})\s+(.*)$/.exec(lines[0]!)
        if (heading && lines.length === 1) return <h3 key={i}>{inline(heading[2]!)}</h3>
        if (lines.every((l) => BULLET.test(l)))
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(BULLET, ''))}</li>
              ))}
            </ul>
          )
        if (lines.every((l) => NUMBER.test(l)))
          return (
            <ol key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(NUMBER, ''))}</li>
              ))}
            </ol>
          )
        return <p key={i}>{inline(lines.join(' '))}</p>
      })}
    </div>
  )
}
