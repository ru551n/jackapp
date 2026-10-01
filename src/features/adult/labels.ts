import type { AgeBand, ArtifactType, ApprovalState, SchoolPosition, SourceMode } from '../../../shared/contracts'

// Plain-Swedish labels for contract enums.

export const AGE_BAND: Record<AgeBand, string> = {
  early: 'Förskoleklass–åk 3',
  middle: 'Åk 4–9',
  upper: 'Gymnasiet',
}

export function schoolLabel(p: SchoolPosition): string {
  if (p.stage === 'forskoleklass') return 'Förskoleklass'
  if (p.stage === 'gymnasieskola') return `Gymnasiet år ${p.year}`
  return `Årskurs ${p.year}`
}

/** All valid school positions, as `stage:year` select values. */
export const SCHOOL_OPTIONS: { value: string; label: string }[] = [
  { stage: 'forskoleklass', year: 0 } as SchoolPosition,
  ...Array.from({ length: 9 }, (_, i) => ({ stage: 'grundskola', year: i + 1 }) as SchoolPosition),
  ...Array.from({ length: 3 }, (_, i) => ({ stage: 'gymnasieskola', year: i + 1 }) as SchoolPosition),
].map((p) => ({ value: `${p.stage}:${p.year}`, label: schoolLabel(p) }))

export const toSchool = (v: string): SchoolPosition => {
  const [stage, year] = v.split(':')
  return { stage: stage as SchoolPosition['stage'], year: Number(year) }
}
export const fromSchool = (p: SchoolPosition) => `${p.stage}:${p.year}`

export const ARTIFACT_TYPE: Record<ArtifactType, string> = {
  practiceTest: 'Övningsprov',
  exercises: 'Övningar',
  lesson: 'Lektion',
  revision: 'Repetition',
  worksheet: 'Arbetsblad',
  flashcards: 'Kort att vända',
  readingComprehension: 'Läsförståelse',
  explanation: 'Förklaring',
  summary: 'Sammanfattning',
  story: 'Berättelse',
  writingPrompt: 'Skrivuppgift',
  project: 'Projekt',
}

export const APPROVAL: Record<ApprovalState, string> = {
  draft: 'Utkast',
  pendingApproval: 'Väntar på godkännande',
  approved: 'Godkänt',
  rejected: 'Avvisat',
}

export const ITEM_KIND: Record<string, string> = {
  multipleChoice: 'Flerval (ett svar)',
  multiSelect: 'Flerval (flera svar)',
  trueFalse: 'Sant eller falskt',
  fillBlank: 'Fyll i luckan',
  matching: 'Para ihop',
  ordering: 'Sätt i ordning',
  numeric: 'Svar med siffror',
  freeText: 'Fritt svar',
  flashcard: 'Kort att vända',
}

export const SOURCE_MODE: Record<SourceMode, { label: string; help: string }> = {
  strict: {
    label: 'Bara materialet',
    help: 'Alla frågor kommer från det uppladdade materialet och visar var i materialet de hör hemma.',
  },
  sourceAndCurriculum: {
    label: 'Materialet och läroplanen',
    help: 'Materialet är grunden. Läroplanen används som stöd för att fylla ut.',
  },
  extended: {
    label: 'Utökat',
    help: 'Materialet är en utgångspunkt. Uppgifterna får gå utanför det.',
  },
}

export const TRANSFORMS = [
  ['simplify', 'Förenkla språket'],
  ['easier', 'Lättare'],
  ['harder', 'Svårare'],
  ['moreVisual', 'Mer bildstöd'],
  ['changeTheme', 'Byt tema'],
  ['shorten', 'Kortare'],
  ['expand', 'Längre'],
  ['more', 'Mer av samma (nytt material)'],
] as const

export const DIFFICULTY: Record<number, string> = {
  1: 'Mycket lätt',
  2: 'Lätt',
  3: 'Lagom för årskursen',
  4: 'Utmanande',
  5: 'Mycket utmanande',
}

export const RELATIVE_LEVEL: Record<number, string> = {
  1: 'Långt under årskursen',
  2: 'Något under årskursen',
  3: 'Som förväntat för årskursen',
  4: 'Något över årskursen',
  5: 'Långt över årskursen',
}

/** "math.addition.tens-crossing" → "tens crossing" (fallback when no note exists). */
/** Skill rows show the server's Swedish note; tags are slugs and never shown. */
export const UNNAMED_SKILL = 'Övrig färdighet'

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short', year: 'numeric' })

export type ChoiceKey = 'textAmount' | 'visualSupport' | 'maxChoices' | 'repetition' | 'pace'

/** Presentation choices that are also offered as one-off overrides when generating. */
export const SUPPORT_CHOICES: {
  key: ChoiceKey
  legend: string
  options: readonly (readonly [string | number, string])[]
}[] = [
  {
    key: 'textAmount',
    legend: 'Mängd text',
    options: [
      ['minimal', 'Så lite text som möjligt'],
      ['reduced', 'Mindre text'],
      ['normal', 'Vanlig mängd'],
    ],
  },
  {
    key: 'visualSupport',
    legend: 'Bildstöd',
    options: [
      ['high', 'Mycket bilder och visuellt stöd'],
      ['normal', 'Vanligt'],
      ['low', 'Lite'],
    ],
  },
  {
    key: 'maxChoices',
    legend: 'Högst antal svarsalternativ',
    options: [2, 3, 4, 5, 6].map((n) => [n, String(n)] as const),
  },
  {
    key: 'repetition',
    legend: 'Upprepning',
    options: [
      ['low', 'Lite'],
      ['normal', 'Vanligt'],
      ['high', 'Mycket'],
    ],
  },
  {
    key: 'pace',
    legend: 'Tempo',
    options: [
      ['slow', 'Lugnt'],
      ['normal', 'Vanligt'],
      ['fast', 'Snabbt'],
    ],
  },
]

export const SUPPORT_NOTE = 'Stöd i presentationen påverkar inte hur svårt innehållet är.'

export const splitList = (v: string, sep: RegExp = /,/) =>
  v
    .split(sep)
    .map((x) => x.trim())
    .filter(Boolean)
