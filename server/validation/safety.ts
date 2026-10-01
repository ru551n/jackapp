// Conservative content-safety denylist (Swedish + English). Policy and term list:
// docs/platform/validation.md#safety. Matching is on lowercase text with letter boundaries.

/** Whole word: `stem` followed by one of `endings` (pass '' to allow the bare stem). */
function word(stems: string, endings: string[] = ['']): RegExp {
  const end = endings.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  return new RegExp(`(?<!\\p{L})(?:${stems})(?:${end})(?!\\p{L})`, 'u')
}

export interface SafetyRule {
  re: RegExp
  label: string
  /** Stays a warning even in aircraft context. */
  noEscalate?: boolean
}

/** Violence, weapons and combat: always an error, whatever the subject. */
export const BLOCKED: SafetyRule[] = [
  { re: word('död', ['ar', 'ade', 'at', 'as']), label: 'döda' },
  { re: word('kill|murder', ['', 's', 'ed', 'ing']), label: 'kill/murder' },
  { re: word('mörd', ['a', 'ar', 'ade', 'at', 'are']), label: 'mörda' },
  { re: word('mord', ['', 'et', 'en', 'er']), label: 'mord' },
  {
    re: /(?:skjut\p{L}*|sköt)\s+(?:ihjäl|ner|ned)|(?:shoot(?:s|ing)?|shot)\s+down/u,
    label: 'skjuta ner',
  },
  // Compounds too ("kärnvapen", "vapnet"); "flygvapnet" and "vapensköld" are borderline instead.
  { re: /(?<!flyg)(?:vapen(?!sköld)|vapn)/u, label: 'vapen' },
  { re: word('weapon', ['', 's', 'ry']), label: 'weapon' },
  { re: word('gevär|rifle|pistol|revolver|gun|ammunition|ammo', ['', 'et', 'en', 's']), label: 'skjutvapen' },
  { re: /missil/u, label: 'missil' },
  { re: word('missile', ['', 's']), label: 'missile' },
  { re: word('bomb', ['', 'a', 'ar', 'ade', 'en', 'er', 'erna', 's', 'ing', 'ed']), label: 'bomb' },
  { re: /granat(?!äpple)/u, label: 'granat' },
  { re: word('grenade', ['', 's']), label: 'grenade' },
  { re: word('sprängämne|explosive', ['', 'n', 's']), label: 'sprängämne' },
  { re: word('massaker|massacre|tortyr|torture|terror\\p{L}*', ['', 'n', 's', 'd']), label: 'grovt våld' },
  { re: word('luftstrid|dogfight', ['', 'en', 'er', 'erna', 's']), label: 'luftstrid' },
]

/** Borderline: legitimate in e.g. history or biology, but flagged for an adult to look at. */
export const BORDERLINE: SafetyRule[] = [
  { re: word('döda'), label: 'döda' },
  { re: /krig/u, label: 'krig' },
  { re: word('war', ['', 's']), label: 'war' },
  { re: word('strid|combat|battle', ['', 'en', 'er', 'erna', 's']), label: 'strid' },
  { re: word('soldat|soldier', ['', 'en', 'er', 'erna', 's']), label: 'soldat' },
  { re: word('armé|army|armies', ['', 'n', 'er']), label: 'armé' },
  { re: word('attack', ['', 'era', 'erar', 'erade', 'en', 'er', 's', 'ed', 'ing']), label: 'attack' },
  { re: word('fight|slåss', ['', 's', 'ing', 'er']), label: 'slåss' },
  { re: word('skjut|shoot|shot', ['', 'a', 'er', 's', 'ing']), label: 'skjuta' },
  { re: word('blod|blood|kniv|knife', ['', 'et', 'en', 'ar', 'y']), label: 'blod/kniv' },
  { re: word('militär|military', ['', 'en', 'a']), label: 'militär' },
  { re: /flygvapn|vapensköld/u, label: 'vapen (sammansättning)', noEscalate: true },
]

/** Fighter aircraft are an allowed interest (engineering/aviation) — combat wording near them is not. */
export const AVIATION =
  /flygplan|jaktplan|stridsflyg|gripen|(?<!\p{L})(?:jas|jet|jets|plane|planes|aircraft|fighter|fighters)(?!\p{L})/u

export interface SafetyHit {
  severity: 'error' | 'warning'
  label: string
}

/** Denylist hits for one text. Borderline words become errors when the same text is about aircraft. */
export function scanSafety(text: string): SafetyHit[] {
  const t = text.normalize('NFC').toLowerCase()
  const hits: SafetyHit[] = BLOCKED.filter((r) => r.re.test(t)).map((r) => ({ severity: 'error', label: r.label }))
  const aviation = AVIATION.test(t)
  for (const r of BORDERLINE) {
    if (!r.re.test(t)) continue
    hits.push(
      aviation && !r.noEscalate
        ? { severity: 'error', label: `flyg + ${r.label}` }
        : { severity: 'warning', label: r.label },
    )
  }
  return hits
}
