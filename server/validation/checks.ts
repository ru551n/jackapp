import type {
  AgeBand,
  Artifact,
  GenerationRequest,
  Item,
  ProcessedStudyMaterial,
  SourceMode,
  StudySegment,
  ValidationIssue,
} from '../../shared/contracts'
import { approxEqual, evaluate, promptExpression } from './expr'
import { scanSafety } from './safety'
import { containsWords, detectLanguage, keyTerms, normalize, sentences, stem, tokens } from './text'

// The programmatic checks. Each is pure: (item | artifact, ctx) => issues. Codes, severities and
// heuristics are documented in docs/platform/validation.md.

export interface CheckContext {
  request: GenerationRequest
  material?: ProcessedStudyMaterial
  band: AgeBand
  sourceMode: SourceMode
}
export type ItemCheck = (item: Item, ctx: CheckContext) => ValidationIssue[]
export type ArtifactCheck = (artifact: Artifact, ctx: CheckContext) => ValidationIssue[]

const err = (code: string, message: string, itemId?: string): ValidationIssue => ({
  severity: 'error',
  code,
  message,
  ...(itemId !== undefined && { itemId }),
})
const warn = (code: string, message: string, itemId?: string): ValidationIssue => ({
  ...err(code, message, itemId),
  severity: 'warning',
})

/** Swedish number formatting for messages. */
const fmt = (n: number) => String(Number(n.toPrecision(12))).replace('.', ',')
const q = (s: string) => `"${s.length > 60 ? `${s.slice(0, 57)}...` : s}"`

export const allItems = (a: Artifact): Item[] => a.sections.flatMap((s) => s.items)

/** The text(s) that make up the correct answer. */
export function answerTexts(item: Item): string[] {
  switch (item.kind) {
    case 'multipleChoice':
      return item.choices.filter((c) => c.id === item.answer).map((c) => c.text)
    case 'multiSelect':
      return item.choices.filter((c) => item.answers.includes(c.id)).map((c) => c.text)
    case 'fillBlank':
      return item.blanks.map((b) => b.accepted[0] ?? '')
    case 'matching':
      return item.pairs.flatMap((p) => [p.left, p.right])
    case 'ordering':
      return item.items.map((c) => c.text)
    case 'numeric':
      return [String(item.answer)]
    case 'freeText':
      return item.rubric
    case 'flashcard':
      return [item.back]
    case 'trueFalse':
      return []
  }
}

/** Every learner-visible string of an item. */
function itemTexts(item: Item): string[] {
  const t = [item.prompt, ...item.hints, item.explanation ?? '']
  switch (item.kind) {
    case 'multipleChoice':
    case 'multiSelect':
      return [...t, ...item.choices.map((c) => c.text)]
    case 'ordering':
      return [...t, ...item.items.map((c) => c.text)]
    case 'fillBlank':
      return [...t, item.text, ...item.blanks.flatMap((b) => b.accepted)]
    case 'matching':
      return [...t, ...item.pairs.flatMap((p) => [p.left, p.right])]
    case 'freeText':
      return [...t, ...item.rubric, item.sampleAnswer ?? '']
    case 'flashcard':
      return [...t, item.back]
    default:
      return t
  }
}

const dupes = (xs: string[]) => [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))]

// ---------- schema (artifact level; the zod parse runs in the pipeline) ----------

export const schema: ArtifactCheck = (a, ctx) => {
  const out: ValidationIssue[] = []
  const items = allItems(a)
  for (const id of dupes(items.map((i) => i.id)))
    out.push(err('schema.duplicate_item_id', `Uppgifts-id ${q(id)} används mer än en gång.`, id))
  a.sections.forEach((s, i) => {
    if (!s.items.length && !s.body?.trim() && !s.media.length)
      out.push(err('schema.empty_section', `Avsnitt ${i + 1}${s.title ? ` (${q(s.title)})` : ''} är tomt.`))
  })
  if (a.type !== ctx.request.type)
    out.push(err('schema.type_mismatch', `Materialet är av typen ${a.type} men ${ctx.request.type} beställdes.`))
  const want = ctx.request.questionCount
  if (want !== undefined && items.length !== want) {
    const msg = `Materialet har ${items.length} uppgifter men ${want} beställdes.`
    out.push(a.type === 'practiceTest' ? err('schema.item_count', msg) : warn('schema.item_count', msg))
  }
  const kinds = ctx.request.itemKinds
  if (kinds?.length)
    for (const i of items)
      if (!kinds.includes(i.kind))
        out.push(warn('schema.unrequested_kind', `Uppgiftstypen ${i.kind} beställdes inte.`, i.id))
  return out
}

// ---------- answers ----------

export const answers: ItemCheck = (item, ctx) => {
  const out: ValidationIssue[] = []
  const e = (code: string, msg: string) => out.push(err(code, msg, item.id))
  if (item.kind === 'multipleChoice' || item.kind === 'multiSelect') {
    const ids = item.choices.map((c) => c.id)
    if (dupes(ids).length) e('answers.duplicate_choice_id', 'Två svarsalternativ har samma id.')
    if (dupes(item.choices.map((c) => normalize(c.text))).length)
      e('answers.duplicate_choice_text', 'Två svarsalternativ har samma text.')
    if (item.choices.some((c) => !c.text.trim() && !c.media)) e('answers.empty_choice', 'Ett svarsalternativ är tomt.')
    const max = ctx.request.support?.maxChoices
    if (max !== undefined && item.choices.length > max)
      e(
        'answers.too_many_choices',
        `Uppgiften har ${item.choices.length} svarsalternativ men högst ${max} är inställt.`,
      )
    if (item.kind === 'multipleChoice' && !ids.includes(item.answer))
      e('answers.unknown_answer', `Rätt svar (id ${q(item.answer)}) finns inte bland svarsalternativen.`)
    if (item.kind === 'multiSelect') {
      if (!item.answers.length) e('answers.empty_answers', 'Uppgiften saknar rätta svar.')
      if (item.answers.some((a) => !ids.includes(a)))
        e('answers.unknown_answer', 'Minst ett rätt svar finns inte bland svarsalternativen.')
      if (dupes(item.answers).length) e('answers.duplicate_answer', 'Samma rätta svar anges flera gånger.')
      if (new Set(item.answers).size === ids.length && ids.length > 1)
        out.push(warn('answers.all_correct', 'Alla svarsalternativ är rätta.', item.id))
    }
  }
  if (item.kind === 'ordering') {
    const ids = item.items.map((c) => c.id)
    if (dupes(ids).length) e('answers.duplicate_choice_id', 'Två delar i ordningsuppgiften har samma id.')
    const a = [...item.answer].sort().join('\u0000')
    if (item.answer.length !== ids.length || a !== [...ids].sort().join('\u0000'))
      e('answers.not_permutation', 'Rätt ordning måste innehålla varje del exakt en gång.')
  }
  if (item.kind === 'matching') {
    if (dupes(item.pairs.map((p) => normalize(p.left))).length)
      e('answers.duplicate_left', 'Två par har samma vänstra del.')
    if (dupes(item.pairs.map((p) => normalize(p.right))).length)
      e('answers.duplicate_right', 'Två par har samma högra del, så kopplingen blir tvetydig.')
    if (item.pairs.some((p) => !p.left.trim() || !p.right.trim())) e('answers.empty_pair', 'Ett par har en tom del.')
  }
  if (item.kind === 'fillBlank') {
    const n = item.text.split('___').length - 1
    if (n !== item.blanks.length)
      e('answers.blank_count', `Texten har ${n} luckor (___) men ${item.blanks.length} svar anges.`)
    if (item.blanks.some((b) => !b.accepted.length || b.accepted.some((x) => !x.trim())))
      e('answers.blank_empty', 'En lucka har ett tomt godkänt svar.')
  }
  if (item.kind === 'trueFalse' && typeof item.answer !== 'boolean')
    e('answers.missing', 'Uppgiften saknar rätt svar (sant/falskt).')
  if (item.kind === 'numeric' && !Number.isFinite(item.answer)) e('answers.missing', 'Svaret är inte ett giltigt tal.')
  if (item.kind === 'freeText' && !item.rubric.some((r) => r.trim()))
    e('answers.empty_rubric', 'Bedömningsstödet (rubric) är tomt.')
  if (item.kind === 'flashcard' && !item.back.trim()) e('answers.empty_back', 'Kortets baksida är tom.')
  return out
}

// ---------- math ----------

const UNITS: Record<string, string> = {}
for (const [dim, list] of Object.entries({
  length: 'mm cm dm m km mil meter',
  mass: 'g hg kg ton gram',
  volume: 'ml cl dl l liter',
  time: 's sek sekund sekunder min minut minuter h tim timme timmar dygn dag dagar vecka veckor år månad månader',
  money: 'kr kronor krona öre',
  area: 'mm² cm² dm² m² km² mm2 cm2 dm2 m2 km2 ha',
  temperature: '°c °',
  percent: '%',
  count: 'st stycken',
}))
  for (const u of list.split(' ')) UNITS[u] = dim
const RELATED: Record<string, string[]> = { area: ['length'], volume: ['length'] }

function unitDims(unit: string): string[] {
  return normalize(unit)
    .split('/')
    .map((u) => UNITS[u.trim()])
    .filter((d): d is string => !!d)
}

function unitIssues(item: Extract<Item, { kind: 'numeric' }>): ValidationIssue[] {
  if (!item.unit?.trim()) return []
  const dims = unitDims(item.unit)
  // A count noun from the story ("Hur många säten…?" with unit "säten") is not a measurement unit.
  if (!dims.length && normalize(item.prompt).includes(normalize(item.unit).trim())) return []
  if (!dims.length)
    return [warn('math.unit_unknown', `Enheten ${q(item.unit)} känns inte igen; kontrollera den.`, item.id)]
  const inPrompt = [...normalize(item.prompt).matchAll(/\d\s*([\p{L}°²%][\p{L}°²%/\d]*)/gu)].flatMap((m) =>
    unitDims(m[1]!),
  )
  const ok = dims.some((d) => inPrompt.includes(d) || RELATED[d]?.some((r) => inPrompt.includes(r)))
  if (inPrompt.length && !ok)
    return [warn('math.unit_mismatch', `Enheten ${q(item.unit)} passar inte med enheterna i frågan.`, item.id)]
  return []
}

export const math: ItemCheck = (item) => {
  const out: ValidationIssue[] = []
  const expr = item.kind === 'numeric' || item.kind === 'multipleChoice' ? promptExpression(item.prompt) : undefined
  const fromPrompt = expr !== undefined ? evaluate(expr) : undefined
  if (item.kind === 'numeric') {
    let expected: number | undefined
    let source = ''
    if (item.check !== undefined) {
      const r = evaluate(item.check)
      if (!r.ok)
        out.push(
          err('math.check_invalid', `Kontrolluttrycket ${q(item.check)} går inte att räkna ut: ${r.error}.`, item.id),
        )
      else {
        expected = r.value
        source = item.check
        if (fromPrompt?.ok && !approxEqual(fromPrompt.value, r.value))
          out.push(
            err(
              'math.check_mismatch',
              `Kontrolluttrycket ${q(item.check)} räknar inte ut det frågan ställer (${expr}).`,
              item.id,
            ),
          )
      }
    } else if (fromPrompt?.ok) {
      expected = fromPrompt.value
      source = expr!
    } else
      out.push(warn('math.unverified', 'Svaret kunde inte kontrolleras automatiskt (inget kontrolluttryck).', item.id))
    if (expected !== undefined && Number.isFinite(item.answer) && !approxEqual(item.answer, expected, item.tolerance))
      out.push(err('math.answer_mismatch', `Svaret ${fmt(item.answer)} är fel: ${source} = ${fmt(expected)}.`, item.id))
    out.push(...unitIssues(item))
  }
  if (item.kind === 'multipleChoice' && fromPrompt?.ok) {
    const values = item.choices.map((c) => evaluate(c.text))
    if (values.every((v) => v.ok)) {
      const hits = item.choices.filter((_, i) => {
        const v = values[i]!
        return v.ok && approxEqual(v.value, fromPrompt.value)
      })
      const val = `${expr} = ${fmt(fromPrompt.value)}`
      if (!hits.length) out.push(err('math.mc_no_correct', `Inget svarsalternativ är rätt (${val}).`, item.id))
      else if (hits.length > 1)
        out.push(err('math.mc_multiple_correct', `Flera svarsalternativ är rätt (${val}).`, item.id))
      else if (hits[0]!.id !== item.answer)
        out.push(err('math.mc_wrong_answer', `Fel alternativ är markerat som rätt (${val}).`, item.id))
    }
  }
  return out
}

// ---------- leakage ----------

/** Long enough that finding it elsewhere is a real giveaway, not a coincidence. */
const nonTrivial = (s: string) => normalize(s).length >= 4 && !/^[\d\s.,]+$/.test(s.trim())

function numberIn(text: string, n: number): boolean {
  const forms = new Set([String(n), String(n).replace('.', ',')])
  return tokens(text).some((t) => forms.has(t))
}

export const leakage: ItemCheck = (item) => {
  const out: ValidationIssue[] = []
  const answersText = answerTexts(item)
  const hint = item.hints[0]
  if (item.kind === 'numeric') {
    const eq = new RegExp(`=\\s*${String(item.answer).replace('.', '[.,]').replace('-', '[-−]')}(?![\\d.,]*\\d)`)
    if (eq.test(item.prompt)) out.push(err('leakage.answer_in_prompt', 'Frågan visar svaret.', item.id))
    if (hint && (Math.abs(item.answer) >= 10 || !Number.isInteger(item.answer)) && numberIn(hint, item.answer))
      out.push(err('leakage.hint_reveals_answer', 'Första ledtråden avslöjar svaret.', item.id))
  }
  if (item.kind === 'multipleChoice' || item.kind === 'multiSelect') {
    const others = item.choices.filter((c) => !answersText.includes(c.text))
    const leaked = answersText.length && answersText.every((a) => nonTrivial(a) && containsWords(item.prompt, a))
    if (leaked && !others.some((c) => nonTrivial(c.text) && containsWords(item.prompt, c.text)))
      out.push(
        warn(
          'leakage.answer_in_prompt',
          'Rätt svar står ordagrant i frågan, men inget av de felaktiga alternativen.',
          item.id,
        ),
      )
  }
  if (item.kind === 'fillBlank' || item.kind === 'flashcard') {
    if (item.kind === 'flashcard' && normalize(item.back) === normalize(item.prompt))
      out.push(err('leakage.answer_in_prompt', 'Kortets fram- och baksida är identiska.', item.id))
    else if (answersText.some((a) => nonTrivial(a) && containsWords(item.prompt, a)))
      out.push(warn('leakage.answer_in_prompt', 'Svaret står ordagrant i frågan.', item.id))
  }
  if (
    hint &&
    (item.kind === 'multipleChoice' ||
      item.kind === 'fillBlank' ||
      item.kind === 'flashcard' ||
      item.kind === 'multiSelect') &&
    answersText.length &&
    answersText.every((a) => nonTrivial(a) && containsWords(hint, a))
  )
    out.push(err('leakage.hint_reveals_answer', 'Första ledtråden avslöjar svaret.', item.id))
  const ex = normalize(item.explanation ?? '')
  if (ex.length >= 20 && [item.prompt, ...item.hints].some((t) => normalize(t).includes(ex)))
    out.push(err('leakage.explanation_before_answer', 'Förklaringen visas redan innan eleven har svarat.', item.id))
  return out
}

// ---------- language ----------

const ENGLISH_SUBJECT = /^(?:GRGRENG|ENG|ENL|KREI|RETR)/i
const FOREIGN_SUBJECT = /^(?:GRGRMO|GRGRMSP|MOD|FIN|JID|MEA|ROM|SAM|KLA|LAT|SPA)/i

/** Languages items may be in, or undefined when any language is fine (foreign-language subjects). */
function allowedLangs(ctx: CheckContext): Set<string> | undefined {
  const code = ctx.request.subjectCode ?? ctx.material?.subjectGuess ?? ''
  if (FOREIGN_SUBJECT.test(code)) return undefined
  const langs = new Set(['sv'])
  const about = `${ctx.request.topic ?? ''} ${ctx.request.instructions ?? ''}`
  if (ENGLISH_SUBJECT.test(code) || /engelsk|english/i.test(about)) langs.add('en')
  if (ctx.material) langs.add(ctx.material.language.slice(0, 2).toLowerCase())
  return langs
}

export const language: ItemCheck = (item, ctx) => {
  const out: ValidationIssue[] = []
  const allowed = allowedLangs(ctx)
  const lang = item.lang.slice(0, 2).toLowerCase()
  const detected = detectLanguage(item.prompt)
  const expected = allowed?.has('en') ? 'svenska eller engelska' : 'svenska'
  if (allowed && !allowed.has(lang))
    out.push(
      err('language.unexpected_lang', `Uppgiften är märkt som ${q(item.lang)} men ska vara på ${expected}.`, item.id),
    )
  else if (allowed && detected && !allowed.has(detected))
    out.push(err('language.unexpected_lang', `Frågan verkar vara på ${detected} men ska vara på ${expected}.`, item.id))
  else if (detected && (lang === 'sv' || lang === 'en') && detected !== lang)
    out.push(warn('language.mismatch', `Frågan verkar vara på ${detected} men är märkt som ${q(item.lang)}.`, item.id))
  return out
}

// ---------- age / presentation ----------

export const PROMPT_LIMITS: Record<AgeBand, Record<'minimal' | 'reduced' | 'normal', number>> = {
  early: { minimal: 60, reduced: 110, normal: 160 },
  middle: { minimal: 150, reduced: 280, normal: 400 },
  upper: { minimal: 350, reduced: 700, normal: 1000 },
}

export const age: ItemCheck = (item, ctx) => {
  const out: ValidationIssue[] = []
  const amount = ctx.request.support?.textAmount ?? 'normal'
  const limit = PROMPT_LIMITS[ctx.band][amount]
  const text = item.kind === 'fillBlank' ? `${item.prompt} ${item.text}` : item.prompt
  if (text.length > limit) {
    const msg = `Frågan har ${text.length} tecken; högst ${limit} passar för åldern och textmängden (${amount}).`
    out.push(
      text.length > 2 * limit ? err('age.prompt_too_long', msg, item.id) : warn('age.prompt_too_long', msg, item.id),
    )
  }
  if (ctx.band === 'early') {
    const longest = Math.max(0, ...sentences(item.prompt).map((s) => tokens(s).length))
    if (longest > 12)
      out.push(
        warn('age.long_sentence', `En mening har ${longest} ord; yngre elever behöver kortare meningar.`, item.id),
      )
    const words = tokens(item.prompt).filter((t) => /^\p{L}+$/u.test(t))
    const avg = words.reduce((n, w) => n + w.length, 0) / (words.length || 1)
    if ((words.length >= 4 && avg > 7) || words.some((w) => w.length > 16))
      out.push(warn('age.difficult_words', 'Frågan innehåller många långa eller svåra ord för åldern.', item.id))
  }
  return out
}

// ---------- safety ----------

function safetyIssues(texts: string[], itemId?: string): ValidationIssue[] {
  const hits = texts.flatMap(scanSafety)
  const out: ValidationIssue[] = []
  const labels = (sev: string, pred = (_l: string) => true) =>
    [...new Set(hits.filter((h) => h.severity === sev && pred(h.label)).map((h) => h.label))].join(', ')
  const aviation = labels('error', (l) => l.startsWith('flyg + '))
  const blocked = labels('error', (l) => !l.startsWith('flyg + '))
  const borderline = labels('warning')
  if (blocked) out.push(err('safety.blocked', `Innehållet har olämpliga ord om våld eller vapen (${blocked}).`, itemId))
  if (aviation)
    out.push(
      err(
        'safety.aviation_combat',
        `Flygplan ska handla om teknik och flygning, inte strid (${aviation.replaceAll('flyg + ', '')}).`,
        itemId,
      ),
    )
  if (borderline)
    out.push(warn('safety.borderline', `Granska ordval som kan uppfattas som våld (${borderline}).`, itemId))
  return out
}

export const safety: ItemCheck = (item) => safetyIssues(itemTexts(item).filter(Boolean), item.id)

// ---------- grounding ----------

function segmentStems(segs: StudySegment[]): string[] {
  return segs.flatMap((s) => tokens(`${s.text} ${s.data ? JSON.stringify(s.data) : ''}`).map(stem))
}

function supported(term: string, stems: Set<string>, list: string[]): boolean {
  if (stems.has(term)) return true
  // Swedish compounds: "multiplikationstabell" supports "tabell" and vice versa.
  return term.length >= 5 && list.some((s) => s.includes(term) || (s.length >= 5 && term.includes(s)))
}

/** One artifact-level issue when uploads are cited but no material was supplied. */
export function materialMissing(items: Item[], ctx: CheckContext): ValidationIssue[] {
  if (ctx.material || !items.some((i) => i.sources.some((s) => s.kind === 'upload'))) return []
  const msg = 'Uppgifter hänvisar till uppladdat material, men materialet saknas så källorna kan inte kontrolleras.'
  return [
    ctx.sourceMode === 'strict' ? err('grounding.material_missing', msg) : warn('grounding.material_missing', msg),
  ]
}

export const grounding: ItemCheck = (item, ctx) => {
  const out: ValidationIssue[] = []
  const uploads = item.sources.filter((s) => s.kind === 'upload')
  const strict = ctx.sourceMode === 'strict'
  if (strict && !uploads.length)
    out.push(err('grounding.no_upload_source', 'Uppgiften saknar hänvisning till det uppladdade materialet.', item.id))
  const m = ctx.material
  if (!m || !uploads.length) return out
  const cited: StudySegment[] = []
  for (const ref of uploads) {
    const seg = ref.studySetId === m.studySetId ? m.segments.find((s) => s.id === ref.segmentId) : undefined
    if (!seg || seg.page !== ref.page) {
      out.push(
        err(
          'grounding.unknown_segment',
          `Källhänvisningen (sida ${ref.page}, avsnitt ${q(ref.segmentId)}) finns inte i materialet.`,
          item.id,
        ),
      )
      continue
    }
    cited.push(seg)
    if (ref.excerpt === undefined) continue
    if (ref.excerpt.length > 300)
      out.push(err('grounding.excerpt_too_long', 'Ett källutdrag är längre än 300 tecken.', item.id))
    else if (!ref.excerpt.split(/\.\.\.|…/).every((p) => normalize(seg.text).includes(normalize(p))))
      out.push(
        err('grounding.excerpt_not_in_source', `Källutdraget ${q(ref.excerpt)} finns inte i materialet.`, item.id),
      )
  }
  if (!cited.length) return out
  const list = segmentStems(cited)
  const stems = new Set(list)
  const aTerms = keyTerms(answerTexts(item).join(' '))
  const all = [...new Set([...aTerms, ...keyTerms(item.prompt)])]
  const missing = all.filter((t) => !supported(t, stems, list))
  const aMissing = aTerms.filter((t) => missing.includes(t))
  const unsupported =
    (aTerms.length > 0 && aMissing.length / aTerms.length > 0.5) ||
    (all.length >= 2 && missing.length / all.length > 0.6)
  if (unsupported) {
    const msg = `Frågan och svaret stöds inte tydligt av de citerade avsnitten (saknas: ${missing.slice(0, 5).join(', ')}).`
    out.push(strict ? err('grounding.unsupported', msg, item.id) : warn('grounding.unsupported', msg, item.id))
  }
  return out
}

/** Item-level checks in pipeline order. */
export const ITEM_CHECKS: Record<string, ItemCheck> = { answers, math, leakage, language, age, safety, grounding }

/** Artifact-level wrappers: run an item check over every item, plus artifact-wide extras. */
export const ARTIFACT_CHECKS: Record<string, ArtifactCheck> = {
  schema,
  ...Object.fromEntries(
    Object.entries(ITEM_CHECKS).map(([name, check]) => [
      name,
      (a: Artifact, ctx: CheckContext) => [
        ...(name === 'safety'
          ? safetyIssues([a.title, ...a.sections.flatMap((s) => [s.title ?? '', s.body ?? ''])].filter(Boolean))
          : []),
        ...(name === 'grounding' ? materialMissing(allItems(a), ctx) : []),
        ...allItems(a).flatMap((i) => check(i, ctx)),
      ],
    ]),
  ),
}
