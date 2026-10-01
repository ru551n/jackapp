// Subject-code classes shared by prompts and checks (Skolverket codes: GRGRxxx01 grundskola, short gymnasium codes).

/** English as the subject's target language. */
const ENGLISH = /^(?:GRGRENG|ENG|ENL|KREI|RETR)/i
/** Moderna språk, Kinesiska, Latin, Klassisk grekiska, Språk specialisering. Modersmål is not one of them. */
const FOREIGN = /^(?:GRGRMSP|MOD(?!E)|KIN|KLA|LAT|SPA)/i
/** History, social studies, biology and religion: violence and death are factual curriculum content there. */
const FACTUAL = /^(?:GRGR)?(?:HIS|SAM(?![WXY])|BIO(?!E)|REL)/i

/** The language a subject teaches: 'en', 'foreign' (any non-Swedish), or undefined (Swedish only). */
export function targetLanguage(code: string | undefined): 'en' | 'foreign' | undefined {
  if (!code) return undefined
  if (ENGLISH.test(code)) return 'en'
  if (FOREIGN.test(code)) return 'foreign'
  return undefined
}

export const isFactualSubject = (code: string | undefined) => !!code && FACTUAL.test(code)
