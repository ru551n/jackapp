import type { AgeBand } from '../../shared/contracts'
import { isFactualSubject } from './subjects'

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
}

/** Gore, instructions and glorification: always an error, for every age and subject. */
export const HARD: SafetyRule[] = [
  {
    re: /inälvor|lemläst|stympa|styck(?:a|ade|at)\s+(?:upp|kropp)|(?<!\p{L})gor[ey]|dismember|mutilat/u,
    label: 'grovt våld',
  },
  {
    re: /(?:hur man|så här|steg för steg)\P{L}.{0,40}(?:tillverka|bygg|blanda|gör)\p{L}*.{0,30}(?:bomb|vapen|sprängämne|krut)|(?:tillverka|bygga|blanda)\s+(?:en\s+|ett\s+)?(?:bomb|vapen|sprängämne|krut)|how to (?:make|build)\s+(?:a\s+)?(?:bomb|weapon|gun|explosive)/u,
    label: 'instruktion om vapen',
  },
  {
    re: /(?:häftigt|kul|roligt|coolt|skönt)\s+att\s+(?:döda|mörda|skjuta|kriga|bomba)|(?:fun|cool|awesome)\s+to\s+(?:kill|shoot|murder)/u,
    label: 'förhärligande av våld',
  },
]

/** Violence and weapons: an error for younger learners, a warning where it is factual curriculum content. */
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
  // Compounds too ("atombomberna", "bombplan"), not "bombastisk".
  { re: /bomb(?!ast)/u, label: 'bomb' },
  // "Granat" alone is a mineral.
  { re: /handgranat/u, label: 'granat' },
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
  // "Angle of attack" is aerodynamics.
  { re: /(?<!angle of )(?<!\p{L})attack(?:era|erar|erade|en|er|s|ed|ing)?(?!\p{L})/u, label: 'attack' },
  { re: word('fight|slåss', ['', 's', 'ing']), label: 'slåss' },
  { re: word('skjut|shoot|shot', ['', 'a', 'er', 's', 'ing']), label: 'skjuta' },
  { re: word('blod|blood|kniv|knife', ['', 'et', 'en', 'ar', 'y']), label: 'blod/kniv' },
  { re: word('militär|military', ['', 'en', 'a']), label: 'militär' },
  { re: /flygvapn|vapensköld/u, label: 'vapen (sammansättning)' },
]

/** Fighter aircraft are an allowed interest (engineering/aviation) — combat wording near them is not. */
export const AVIATION =
  /flygplan|jaktplan|stridsflyg|gripen|(?<!\p{L})(?:jas|jet|jets|plane|planes|aircraft|fighter|fighters)(?!\p{L})/gu
/** Combat verbs that turn an aircraft text into a combat text when they stand close to the aircraft word. */
const COMBAT =
  /(?:skjut\p{L}*|sköt)\s+(?:ner|ned|ihjäl)|bomba(?:r|de|t)?(?!\p{L})|anfall(?!svinkel)\p{L}*|anföll|död(?:ar|ade|a)(?!\p{L})|(?:shoot(?:s|ing)?|shot)\s+down|strafing|bombing|bombed/gu
/** Characters between aircraft word and combat verb that still count as "close" (about one clause). */
const NEAR = 60

export interface SafetyHit {
  severity: 'error' | 'warning'
  label: string
}

export interface SafetyContext {
  band?: AgeBand
  subjectCode?: string
}

/** Older learners, and history/samhälle/biology/religion in the middle years, meet violence as facts. */
export const factualContext = (c: SafetyContext = {}) =>
  c.band === 'upper' || (c.band === 'middle' && isFactualSubject(c.subjectCode))

function aircraftCombat(t: string): boolean {
  const planes = [...t.matchAll(AVIATION)].map((m) => m.index)
  if (!planes.length) return false
  return [...t.matchAll(COMBAT)].some((m) => planes.some((p) => Math.abs(p - m.index) <= NEAR))
}

/** Denylist hits for one text; severity depends on age band and subject. */
export function scanSafety(text: string, ctx: SafetyContext = {}): SafetyHit[] {
  const t = text.normalize('NFC').toLowerCase()
  const factual = factualContext(ctx)
  const hits: SafetyHit[] = HARD.filter((r) => r.re.test(t)).map((r) => ({ severity: 'error', label: r.label }))
  for (const r of BLOCKED) if (r.re.test(t)) hits.push({ severity: factual ? 'warning' : 'error', label: r.label })
  for (const r of BORDERLINE) if (r.re.test(t)) hits.push({ severity: 'warning', label: r.label })
  if (aircraftCombat(t)) hits.push({ severity: 'error', label: 'flyg + strid' })
  return hits
}
