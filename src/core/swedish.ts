// Swedish language helpers for content and UI.

const WORDS = [
  'noll',
  'ett',
  'två',
  'tre',
  'fyra',
  'fem',
  'sex',
  'sju',
  'åtta',
  'nio',
  'tio',
  'elva',
  'tolv',
  'tretton',
  'fjorton',
  'femton',
  'sexton',
  'sjutton',
  'arton',
  'nitton',
  'tjugo',
]

/** Number word (neuter "ett"); use `en` for common-gender nouns ("en vagn"). */
export function numberWord(n: number, gender: 'ett' | 'en' = 'ett'): string {
  if (n === 1) return gender
  return WORDS[n] ?? String(n)
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** "Två uppdrag till för att låsa upp Gripen." */
export function missionsLeftText(remaining: number, name: string): string {
  if (remaining <= 1) return `Ett uppdrag till för att låsa upp ${name}.`
  return `${capitalize(numberWord(remaining))} uppdrag till för att låsa upp ${name}.`
}
