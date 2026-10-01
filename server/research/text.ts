// Lightweight HTML → readable text. Not a full parser: drops non-content blocks, turns block
// tags into line breaks, strips the rest and decodes common entities. Good enough as model input.

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  shy: '',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  aring: 'å',
  auml: 'ä',
  ouml: 'ö',
  Aring: 'Å',
  Auml: 'Ä',
  Ouml: 'Ö',
  eacute: 'é',
  uuml: 'ü',
  deg: '°',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ''
    }
    return NAMED[e] ?? m
  })
}

/** Strip tags (for short metadata strings like a Commons "Artist" field). */
export const stripHtml = (s: string) =>
  decodeEntities(s.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

const DROP =
  /<(script|style|noscript|svg|template|iframe|head|nav|footer|header|aside|form|button|select)\b[\s\S]*?<\/\1\s*>/gi
const BLOCK =
  /<\/?(p|div|br|li|ul|ol|h[1-6]|tr|td|th|table|section|article|main|blockquote|pre|dd|dt|figcaption)\b[^>]*>/gi

export function htmlToText(html: string): { title?: string; siteName?: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
  const site =
    /<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1] ??
    /<meta[^>]+content=["']([^"']*)["'][^>]*property=["']og:site_name["']/i.exec(html)?.[1]
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(DROP, ' ')
    .replace(BLOCK, '\n')
    .replace(/<[^>]*>/g, ' ')
  const text = decodeEntities(body)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
  return {
    title: title ? stripHtml(title) || undefined : undefined,
    siteName: site ? stripHtml(site) || undefined : undefined,
    text,
  }
}
