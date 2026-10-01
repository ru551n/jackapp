import {
  ageBand,
  type AgeBand,
  type LearnerProfileInput,
  type SchoolPosition,
  type SupportPreferences,
} from '../../shared/contracts'

// Profile service used by learner screens and generation. See docs/platform/learners.md.

/** Small guard against obviously unsafe themes reaching AI prompts. Adults are trusted; this is not moderation. */
const UNSAFE_THEME = /\b(porr|porn|naken|nude|nazi\w*|självmord|suicide|självskad\w*|droger|drugs|knark|terror\w*)\b/iu

export function unsafeThemes(items: string[]): string[] {
  return items.filter((t) => UNSAFE_THEME.test(t))
}

/** Trim, drop blanks and duplicates (case-insensitive). */
export function cleanList(items: string[]): string[] {
  const seen = new Set<string>()
  return items.map((s) => s.trim()).filter((s) => s && !seen.has(s.toLowerCase()) && seen.add(s.toLowerCase()))
}

export interface Presentation extends SupportPreferences {
  ageBand: AgeBand
  school: SchoolPosition
}

/** Effective presentation settings: support preferences + age band + school position. */
export function presentationFor(p: LearnerProfileInput): Presentation {
  return { ...p.support, ageBand: ageBand(p.school), school: p.school }
}

const STAGE_SV = { forskoleklass: 'förskoleklass', grundskola: 'grundskola', gymnasieskola: 'gymnasieskola' } as const

/** Functional phrasing of non-default support preferences. */
function supportNeeds(s: SupportPreferences): string[] {
  const out: string[] = []
  if (s.textAmount === 'minimal') out.push('mycket lite text')
  if (s.textAmount === 'reduced') out.push('korta texter')
  if (s.visualSupport === 'high') out.push('mycket bildstöd')
  if (s.visualSupport === 'low') out.push('lite bildstöd')
  out.push(`högst ${s.maxChoices} svarsalternativ`)
  if (s.stepByStep) out.push('en sak i taget, steg för steg')
  if (s.repetition === 'high') out.push('mycket repetition')
  if (s.repetition === 'low') out.push('lite repetition')
  if (s.pace === 'slow') out.push('lugnt tempo')
  if (s.pace === 'fast') out.push('raskt tempo')
  if (s.extraThinkingTime) out.push('gott om betänketid')
  if (s.reducedVisualComplexity) out.push('enkla, avskalade bilder')
  out.push(`pass på cirka ${s.sessionMinutes} minuter`)
  return out
}

/**
 * Compact, non-sensitive learner summary for AI prompts. Never includes the display name,
 * strengths or difficulties free text; any occurrence of the name in included text is replaced.
 */
export function promptProfile(p: LearnerProfileInput): string {
  const name = p.displayName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const scrub = (s: string) =>
    name ? s.replace(new RegExp(`(?<![\\p{L}\\p{N}])${name}(s?)(?![\\p{L}\\p{N}])`, 'giu'), 'eleven$1') : s
  const year = p.school.stage === 'forskoleklass' ? '' : `, år ${p.school.year}`
  const lines = [`Elev i ${STAGE_SV[p.school.stage]}${year} (åldersgrupp: ${ageBand(p.school)}).`]
  if (p.subjectLevels.length)
    lines.push(
      'Nivåer: ' +
        p.subjectLevels
          .map(
            (l) =>
              `${l.subjectCode}: ${scrub(l.description)}${l.relativeLevel ? ` (${l.relativeLevel}/5, 3 = som förväntat)` : ''}`,
          )
          .join('; ') +
        '.',
    )
  const likes = cleanList([...p.interests, ...p.themes]).map(scrub)
  if (likes.length) lines.push(`Intressen och teman: ${likes.join(', ')}.`)
  lines.push(`Presentation: ${supportNeeds(p.support).join(', ')}.`)
  return lines.join('\n')
}
