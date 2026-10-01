import { z } from 'zod'
import { AgeBand } from '../../shared/contracts'

// Pure prompt building and request screening for AI illustrations (docs/platform/images.md).

export const ImagePurpose = z.enum(['illustration', 'counting', 'diagram'])
export type ImagePurpose = z.infer<typeof ImagePurpose>

export const ImageStyle = z.object({
  ageBand: AgeBand,
  /** The learner's special interest, e.g. "tåg", "flygplan", "dinosaurier". */
  theme: z.string().max(60).optional(),
})
export type ImageStyle = z.infer<typeof ImageStyle>

/** `path` locates the media slot in an artifact: "sections.0", "sections.0.items.2" or "sections.0.items.2.choices.1". */
export const MediaPath = z.string().regex(/^sections\.\d+(\.items\.\d+(\.(choices|items)\.\d+)?)?$/)

/** Where a finished image goes: `path` in `artifactId`; `itemId` re-locates the item if it moved. */
export const MediaTarget = z.object({ path: MediaPath, itemId: z.string().max(60).optional() })

export const ImageJobPayload = z
  .object({
    purpose: ImagePurpose,
    /** School subject or topic, e.g. "matematik", "historia". */
    subject: z.string().max(100),
    /** What to show, in Swedish (also becomes the alt text). */
    description: z.string().min(1).max(280),
    style: ImageStyle,
    /** Required for counting: the exact number of objects. */
    count: z.number().int().min(1).max(20).optional(),
    /** Text in the image only when explicitly requested (models garble text; the UI adds labels). */
    allowText: z.boolean().default(false),
    learnerId: z.string().uuid().optional(),
    artifactId: z.string().uuid().optional(),
    target: MediaTarget.optional(),
  })
  .refine((p) => p.purpose !== 'counting' || p.count !== undefined, { message: 'count krävs för räknebilder' })
export type ImageJobPayload = z.infer<typeof ImageJobPayload>

const BAND_STYLE: Record<AgeBand, string> = {
  early:
    'Friendly picture-book style for young children: simple rounded shapes, soft calm colours, plain light background, one clear focal point.',
  middle: 'Clear, friendly flat illustration with simple shapes, calm colours and a plain background.',
  upper: 'Clean, diagram-like flat illustration: precise simple lines, limited calm palette, white background.',
}

export function buildImagePrompt(p: Omit<ImageJobPayload, 'allowText'> & { allowText?: boolean }): string {
  const lines = ['A calm, uncluttered educational illustration for a school learning app.', BAND_STYLE[p.style.ageBand]]
  if (p.purpose === 'diagram')
    lines.push('Diagram layout: clearly separated parts with generous spacing so labels can be added beside it.')
  if (p.style.theme)
    lines.push(`Theme: the learner loves "${p.style.theme}"; use that theme in a friendly, calm way where it fits.`)
  if (p.subject) lines.push(`School subject: ${p.subject}.`)
  lines.push(`Scene: ${p.description}`)
  if (p.purpose === 'counting')
    lines.push(
      `Show EXACTLY ${p.count} of the objects to count, no more and no fewer: clearly separated, not overlapping, all fully visible, easy to count. No other objects that could be counted.`,
    )
  if (!p.allowText) lines.push('Do not include any text, letters, numbers, labels, captions or signs in the image.')
  lines.push(
    'No violence, weapons, blood, injuries, danger or scary content. Not photorealistic.',
    'No real or recognisable people; any people are simple friendly cartoon figures. Never a realistic child.',
  )
  return lines.join('\n')
}

/** Swedish alt text for the stored asset. */
export const altText = (p: Pick<ImageJobPayload, 'description'>) => `AI-genererad bild: ${p.description}`.slice(0, 300)

// ---- Screening ----

// Letter-aware boundaries (\b does not understand å/ä/ö).
const word = (src: string) => new RegExp(`(?<![\\p{L}\\d])(?:${src})(?![\\p{L}\\d])`, 'iu')
/** Suffix boundary only, so compounds match ("Europakarta", "Sverigeflagga"). */
const tail = (src: string) => new RegExp(`(?:${src})(?![\\p{L}\\d])`, 'iu')

const MAP = tail('kart(?:a|an|or|orna|bild)|atlas|maps?')
const FLAG = tail('flagg(?:a|an|or|orna)|flags?')
const IDENTIFY = word('riktiga?|verkliga?|äkta|autentiska?|känna igen|identifiera|artbestäm\\p{L}*')
/** Vehicle makes and named models children ask for (aircraft, trains, cars). */
const MAKES = word(
  'saab|volvo|scania|boeing|airbus|cessna|bombardier|lockheed|douglas|junkers|spitfire|jas|viggen|gripen|draken|tunnan|x2000|alstom|siemens|tesla',
)
/** A model designation: "Saab 37", "Boeing 747", "A320", "Rc6". */
const DESIGNATION = /(?<![\p{L}\d])\p{Lu}\p{L}*[ -]?\d{2,}|(?<![\p{L}\d])[A-Z]{1,3}\d+(?![\p{L}\d])/u
const ARTIFACT = /fynd|artefakt|föremål|runsten|fornlämning|fossil|skelett|svärd|hjälm|mynt|smycke/i
const FACT_SUBJECT = /histori|geografi|samhäll|biologi|arkeologi|history|geography/i

/** True when a capitalised word appears after a sentence's first word (a proper noun: a place, person or brand). */
const hasProperNoun = (text: string) =>
  text.split(/[.!?:;]\s+/).some((s) =>
    s
      .trim()
      .split(/\s+/)
      .slice(1)
      .some((w) => /^\p{Lu}\p{Ll}/u.test(w)),
  )

/**
 * Deterministic: does this need real, licensed imagery rather than an AI illustration?
 * True for maps, flags, "real/authentic/identify" wording, vehicle makes and model numbers,
 * proper nouns (named places, finds, people, characters) and artifacts in fact subjects.
 * Errs towards true; a false positive only means a licensed image is searched instead.
 */
export function needsRealImagery(description: string, subject = ''): boolean {
  return (
    MAP.test(description) ||
    FLAG.test(description) ||
    IDENTIFY.test(description) ||
    MAKES.test(description) ||
    DESIGNATION.test(description) ||
    hasProperNoun(description) ||
    (FACT_SUBJECT.test(subject) && ARTIFACT.test(description))
  )
}

const UNSAFE = word(
  'blodig\\p{L}*|blodbad|mord|mörda\\p{L}*|döda|dödar|dödad|lik|skjut\\p{L}*|pistol\\p{L}*|gevär\\p{L}*|vapen|bomber?|kniv\\p{L}*|skräck\\p{L}*|läskig\\p{L}*|zombie\\p{L}*|demoner?|blood|kill|killing|killer|guns?|weapons?|horror|gore|fotorealistisk\\p{L}*|photorealistic|foto|fotot|fotografi\\p{L}*|photo\\p{L}*',
)

export type ImageRefusal = { code: 'factual_reference' | 'unsafe_content'; message: string }

/** Content screening before any provider call. Swedish adult-facing messages. */
export function screenRequest(p: Pick<ImageJobPayload, 'description' | 'subject'>): ImageRefusal | undefined {
  if (UNSAFE.test(p.description))
    return {
      code: 'unsafe_content',
      message:
        'Bilden kan inte skapas: beskrivningen innehåller våld, vapen, skrämmande innehåll eller foto av verkliga personer.',
    }
  if (needsRealImagery(p.description, p.subject))
    return {
      code: 'factual_reference',
      message:
        'AI-bilder används inte som faktabilder (verkliga flygplansmodeller, fornfynd, kartor, personer). Använd en licensierad bild från bildsökningen i stället.',
    }
  return undefined
}
