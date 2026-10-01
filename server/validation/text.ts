// Text helpers for the heuristic checks: normalization, tokens, naive Swedish/English stemming,
// stopword-based language detection.

export function normalize(s: string): string {
  return s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Word and number tokens, lowercased ("3,5" and "3.5" stay one token). */
export function tokens(s: string): string[] {
  return normalize(s).match(/[\p{L}\p{N}]+(?:[.,]\p{N}+)*/gu) ?? []
}

/** True if `needle` occurs in `hay` as whole words (case/whitespace-insensitive). */
export function containsWords(hay: string, needle: string): boolean {
  const n = normalize(needle)
  if (!n) return false
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'u').test(normalize(hay))
}

// Longest first. ponytail: naive suffix stripping; swap for a Snowball port if recall matters.
const SUFFIXES = (
  'arnas ernas ornas heten heter ingen arna erna orna ande ende aste ning ing het ast are ade ens ets ies ' +
  'ed at ad as ar er or en et na es a e s t'
).split(' ')

export function stem(word: string): string {
  if (/\p{N}/u.test(word)) return word
  for (const suf of SUFFIXES) if (word.length - suf.length >= 3 && word.endsWith(suf)) return word.slice(0, -suf.length)
  return word
}

export const STOP_SV = new Set(
  (
    'och att det som en ett är på av för med till den har de inte om var vad hur vilken vilket vilka hon han jag du vi ' +
    'kan ska när eller men från så sig där efter också alla hade bara finns många mycket varför blir här nu sin sina ' +
    'sitt dem oss dig mig honom henne ut upp sedan än i vid dessa denna detta där hos utan vara varit blev skulle'
  ).split(' '),
)
export const STOP_EN = new Set(
  (
    'the and to of a is in that it for on with as was are be this have from or by what which who how why when ' +
    'where do does you he she we they can will not there their my your his her an at if were has had its these those'
  ).split(' '),
)
/** Generic exercise vocabulary that says nothing about the content. */
const GENERIC = new Set(
  (
    'välj skriv rätt fel svar svaret stämmer påstående påståendet meningen mening ordet ord fyll följande beskriv ' +
    'förklara fråga frågan nedan texten enligt sant falskt alternativ visa ange nämn choose write correct answer ' +
    'sentence word words true false following text explain describe question'
  ).split(' '),
)

/** Content-bearing stemmed terms (no stopwords, generic exercise words, short words or numbers). */
export function keyTerms(s: string): string[] {
  return [
    ...new Set(
      tokens(s)
        .filter((t) => t.length >= 4 && !/\p{N}/u.test(t) && !STOP_SV.has(t) && !STOP_EN.has(t) && !GENERIC.has(t))
        .map(stem),
    ),
  ]
}

/** 'sv' | 'en' when the stopword evidence is clear, otherwise undefined. */
export function detectLanguage(s: string): 'sv' | 'en' | undefined {
  let sv = /[åäö]/i.test(s) ? 1 : 0
  let en = 0
  for (const t of tokens(s)) {
    if (STOP_SV.has(t)) sv++
    if (STOP_EN.has(t)) en++
  }
  if (sv >= 2 && sv >= 2 * en + 1) return 'sv'
  if (en >= 2 && en >= 2 * sv + 1) return 'en'
  return undefined
}

export function sentences(s: string): string[] {
  return s
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => x.trim())
    .filter(Boolean)
}
