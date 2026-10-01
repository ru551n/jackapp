import type { ItemKind, MediaRef, StudySetStatus, SupportPreferences } from '../../../shared/contracts'
import type { SpeechLang } from '../../core/types'

/** Presentation band: early/middle/upper learners, or the adult area. */
export type Variant = 'early' | 'middle' | 'upper' | 'adult'

/** Support preferences that change presentation (never difficulty). */
export type Presentation = Partial<
  Pick<SupportPreferences, 'maxChoices' | 'textAmount' | 'visualSupport' | 'readAloud' | 'reducedMotion' | 'stepByStep'>
>

export interface CommonProps {
  learnerId: string
  variant: Variant
  presentation?: Presentation
}

/** Swedish names for item kinds (configurator, history). */
export const KIND_LABELS: Record<ItemKind, string> = {
  multipleChoice: 'Flerval (ett svar)',
  multiSelect: 'Flerval (flera svar)',
  trueFalse: 'Sant eller falskt',
  fillBlank: 'Fyll i luckor',
  matching: 'Para ihop',
  ordering: 'Sätt i ordning',
  numeric: 'Svara med ett tal',
  freeText: 'Skriv eget svar',
  flashcard: 'Glosor och begreppskort',
}

/** Item as served by the runs API while a run is active (no answers, hints or rubric). */
export interface PublicChoice {
  id: string
  text: string
  media?: MediaRef
}
export interface PublicItem {
  id: string
  kind: ItemKind
  prompt: string
  lang?: string
  media?: MediaRef[]
  skills?: string[]
  hintCount?: number
  choices?: PublicChoice[]
  text?: string
  blankCount?: number
  left?: string[]
  right?: string[]
  items?: PublicChoice[]
  unit?: string
  back?: string
}

/** SpeakButton only knows Swedish and English; other languages get no read-aloud. */
export const speechLang = (lang?: string): SpeechLang | undefined =>
  !lang || lang.startsWith('sv') ? 'sv' : lang.startsWith('en') ? 'en' : undefined

/** Error text: adults see the API message, learners a calm line. */
export const errorText = (variant: Variant, e: unknown, learnerLine: string) =>
  variant === 'adult' && e instanceof Error ? e.message : learnerLine

/** Answer shown when nothing has been touched yet (ordering starts from the served order). */
export function initialValue(item: PublicItem): unknown {
  if (item.kind === 'ordering') return item.items?.map((c) => c.id) ?? []
  if (item.kind === 'fillBlank') return Array.from({ length: blankCount(item) }, () => '')
  if (item.kind === 'matching') return item.left?.map(() => '') ?? []
  if (item.kind === 'multiSelect') return []
  if (item.kind === 'freeText') return { text: '' }
  return undefined
}

/** True when the value is complete enough to send. */
export function isAnswered(item: PublicItem, v: unknown): boolean {
  switch (item.kind) {
    case 'multipleChoice':
      return typeof v === 'string' && v !== ''
    case 'trueFalse':
      return typeof v === 'boolean'
    case 'multiSelect':
      return Array.isArray(v) && v.length > 0
    case 'fillBlank':
    case 'matching':
      return Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string' && s.trim() !== '')
    case 'ordering':
      return Array.isArray(v) && v.length > 0
    case 'numeric':
      return typeof v === 'string' && v.trim() !== ''
    case 'freeText':
      return !!(v as { text?: string } | undefined)?.text?.trim()
    case 'flashcard':
      return typeof v === 'string'
  }
}

export const blankCount = (item: PublicItem) =>
  item.blankCount ?? Math.max(1, (item.text ?? '').split('___').length - 1)
export const RATINGS = [
  { v: 'knew', label: 'Jag kunde' },
  { v: 'partly', label: 'Delvis' },
  { v: 'notYet', label: 'Inte än' },
] as const

/** Study-set status in Swedish. */
export const STATUS_LABEL: Record<StudySetStatus, string> = {
  uploading: 'Laddas upp',
  queued: 'Väntar på att läsas',
  processing: 'Läses nu',
  ready: 'Klart',
  failed: 'Kunde inte läsas',
}
