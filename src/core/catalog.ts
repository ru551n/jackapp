import type { AreaId, SkillId } from './types'

export interface AreaInfo {
  id: AreaId
  name: string
  /** One short line describing the area for the child. */
  tagline: string
  /** Parent-facing subject. */
  subject: string
  skills: SkillId[]
}

export const AREAS: AreaInfo[] = [
  {
    id: 'stationen',
    name: 'Stationen',
    tagline: 'Läs skyltar och ord',
    subject: 'Läsning',
    skills: ['read.letters', 'read.words', 'read.missingLetter', 'read.sentences'],
  },
  {
    id: 'tunnelbanan',
    name: 'Tunnelbanan',
    tagline: 'Räkna vagnar och resenärer',
    subject: 'Matematik',
    skills: ['math.count', 'math.compare', 'math.oneMoreLess', 'math.sequence', 'math.add', 'math.sub'],
  },
  {
    id: 'sparvagnen',
    name: 'Spårvagnen',
    tagline: 'Mönster och ordning',
    subject: 'Logik',
    skills: ['logic.pattern', 'logic.order', 'logic.category'],
  },
  {
    id: 'flygplatsen',
    name: 'Flygplatsen',
    tagline: 'Flygplan, gater och siffror',
    subject: 'Flyg: läsning, siffror och igenkänning',
    skills: ['air.recognize', 'air.read', 'air.numbers', 'air.compare'],
  },
  {
    id: 'engelska',
    name: 'Engelska',
    tagline: 'Ord på engelska: train, plane…',
    subject: 'Engelska',
    skills: ['en.words', 'en.colors', 'en.numbers', 'en.adjectives', 'en.listen', 'en.sentences'],
  },
]

/** Parent-facing skill names. */
export const SKILL_NAMES: Record<SkillId, string> = {
  'read.letters': 'Bokstäver',
  'read.words': 'Ord',
  'read.missingLetter': 'Saknad bokstav',
  'read.sentences': 'Meningar',
  'math.count': 'Räkna antal',
  'math.compare': 'Fler och färre',
  'math.oneMoreLess': 'En mer, en mindre',
  'math.sequence': 'Talföljder',
  'math.add': 'Addition',
  'math.sub': 'Subtraktion',
  'logic.pattern': 'Mönster',
  'logic.order': 'Ordning',
  'logic.category': 'Sortera',
  'air.recognize': 'Känna igen flygplan',
  'air.read': 'Läsa på flygplatsen',
  'air.numbers': 'Siffror på flygplatsen',
  'air.compare': 'Jämföra flygplan',
  'en.words': 'Engelska ord (transport)',
  'en.colors': 'Färger på engelska',
  'en.numbers': 'Siffror 1–10 på engelska',
  'en.adjectives': 'Beskrivande ord (big, small, fast, slow)',
  'en.listen': 'Lyssna på engelska ord',
  'en.sentences': 'Korta meningar på engelska',
}

export const areaById = (id: string): AreaInfo | undefined => AREAS.find((a) => a.id === id)

export function areaOfSkill(skill: SkillId): AreaInfo {
  const area = AREAS.find((a) => a.skills.includes(skill))
  if (!area) throw new Error(`Skill ${skill} belongs to no area`)
  return area
}
