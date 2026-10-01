import type {
  AgeBand,
  ArtifactType,
  ItemKind,
  ProcessedStudyMaterial,
  SchoolPosition,
  SourceMode,
  SupportPreferences,
} from '../../../shared/contracts'
import { isFactualSubject, targetLanguage } from '../../validation/subjects'
import { stem, tokens } from '../../validation/text'

// Versioned prompt building blocks (docs/platform/generation.md#prompt-architecture).
// Bump PROMPT_VERSION whenever wording changes; it is stored on every artifact version.
export const PROMPT_VERSION = 'generation/v4'

export interface OfferedRef {
  /** Local id the model may cite, e.g. "C1". */
  id: string
  subjectName: string
  area?: string | null
  text: string
}

export interface PromptInput {
  type: ArtifactType
  school: SchoolPosition
  band: AgeBand
  /** promptProfile(): compact and name-free. */
  profileText: string
  support: SupportPreferences
  difficulty: number
  theme?: string
  /** Interests are listed (name-scrubbed) in profileText; never pass raw free text here. */
  hasInterests: boolean
  subjectCode?: string
  topic?: string
  sourceMode: SourceMode
  material?: ProcessedStudyMaterial
  curriculum: OfferedRef[]
  hints: boolean
  feedback: 'immediate' | 'end'
  durationMinutes: number
  includeImages: boolean
  /** Required skill tags (learning paths, remediation). */
  skills?: string[]
  /** Web research brief (useWebResearch); sources are cited as W1..Wn. */
  research?: ResearchContext
  /** Skill tags the learner already has evidence for (reuse instead of inventing near-duplicates). */
  knownSkills?: string[]
}

export interface ResearchContext {
  summary: string
  keyPoints: { text: string; sources: number[] }[]
  sources: { title: string; publisher?: string }[]
}

/** Checked web brief; items cite its sources as W1..Wn (never in strict mode). */
export function researchBlock(r: ResearchContext): string {
  return [
    'Webbresearch (sammanfattad ur källorna nedan). Använd den för fakta som inte finns i materialet eller läroplanen.',
    'Ange webSourceIds (t.ex. ["W1"]) när en uppgift bygger på en webbkälla. Hitta inte på andra id.',
    `Sammanfattning: ${r.summary}`,
    ...r.keyPoints.map((k) => `- ${k.text} (${k.sources.map((n) => `W${n}`).join(', ')})`),
    'Källor:',
    ...r.sources.map((s, i) => `- W${i + 1}: ${s.title}${s.publisher ? ` (${s.publisher})` : ''}`),
  ].join('\n')
}

const STAGE = { forskoleklass: 'förskoleklass', grundskola: 'grundskolan', gymnasieskola: 'gymnasiet' } as const

export function roleBlock(): string {
  return [
    'Du är en erfaren svensk lärare som skapar läromaterial i JackApp för en elev i ett hem.',
    'Allt du skriver lagras som strukturerad data och kontrolleras innan eleven ser det.',
    'Svara alltid exakt enligt det givna JSON-schemat. Rätta svar måste vara korrekta och entydiga.',
  ].join('\n')
}

export function ageBlock(school: SchoolPosition, band: AgeBand): string {
  const year = school.stage === 'forskoleklass' ? '' : ` årskurs ${school.year}`
  const tone = {
    early: 'Tidiga år: korta meningar, vardagliga ord, konkreta exempel, varm och lugn ton. Inga långa instruktioner.',
    middle:
      'Mellanår: tydliga instruktioner, konkreta exempel, gärna vardagsanknytning. Ton: respektfull, inte barnslig.',
    upper:
      'Äldre elev: saklig och vuxen ton, ämnesbegrepp används korrekt, resonemang och tillämpning uppmuntras. Inget barnsligt språk.',
  }[band]
  return `Målgrupp: ${STAGE[school.stage]}${year} (åldersgrupp ${band}).\n${tone}`
}

/** Presentation only: how the material looks, never how hard the concepts are. */
export function supportBlock(s: SupportPreferences): string {
  const lines = ['Presentationsstöd (påverkar form, inte svårighetsgrad):']
  lines.push(
    {
      minimal: '- Textmängd: minimal. Mycket korta uppgiftstexter, ett påstående per mening.',
      reduced: '- Textmängd: reducerad. Korta uppgiftstexter, inga onödiga ord.',
      normal: '- Textmängd: normal.',
    }[s.textAmount],
  )
  lines.push(
    {
      high: '- Visuellt stöd: högt. Föreslå en enkel illustration (fältet illustration) där en bild hjälper förståelsen.',
      normal: '- Visuellt stöd: normalt.',
      low: '- Visuellt stöd: lågt. Föreslå bara illustrationer när de är nödvändiga.',
    }[s.visualSupport],
  )
  lines.push(`- Högst ${s.maxChoices} svarsalternativ per uppgift.`)
  if (s.stepByStep) lines.push('- Steg för steg: en sak i taget, dela upp uppgifter i små tydliga steg.')
  if (s.reducedVisualComplexity) lines.push('- Enkla, avskalade bilder och upplägg.')
  if (s.repetition === 'high') lines.push('- Mycket repetition: återkom till samma begrepp på flera sätt.')
  if (s.extraThinkingTime) lines.push('- Gott om betänketid: inga uppmaningar om att skynda sig.')
  return lines.join('\n')
}

/** Interests are a natural theme for young learners, optional and subtle for older ones. */
export function interestBlock(band: AgeBand, theme: string | undefined, hasInterests: boolean): string {
  if (theme) {
    return band === 'early'
      ? `Tema: ${theme}. Använd temat genomgående i exempel och uppgifter.`
      : `Tema: ${theme}. Använd temat där det passar naturligt, på ett sätt som känns ålderslämpligt och inte barnsligt.`
  }
  if (!hasInterests) return 'Inget särskilt tema.'
  return band === 'early'
    ? 'Använd gärna elevens intressen (se elevprofilen) som tema i exemplen.'
    : 'Elevens intressen (se elevprofilen) får användas om det passar naturligt, men det är valfritt.'
}

export function curriculumBlock(refs: OfferedRef[]): string {
  if (!refs.length) return 'Läroplan: inga utdrag angivna. Fältet curriculumIds ska lämnas tomt.'
  return [
    'Läroplan (Skolverket, centralt innehåll). Du får BARA hänvisa till dessa id i curriculumIds, inga andra:',
    ...refs.map((r) => `- ${r.id}: [${r.subjectName}${r.area ? ` / ${r.area}` : ''}] ${r.text}`),
  ].join('\n')
}

export const MATERIAL_CHARS = 14_000

const segLine = (s: ProcessedStudyMaterial['segments'][number]) => `[${s.id}] (sida ${s.page}, ${s.kind}) ${s.text}`

export interface MaterialSelection {
  material: ProcessedStudyMaterial
  /** Set when not every segment fit the prompt budget. */
  truncated?: { pagesUsed: number[]; segmentsUsed: number; segmentsTotal: number; pageRange?: [number, number] }
}

/** "sida 4-7", "s. 4–7", "sidorna 4 till 7" in the request text. */
export function pageRange(text: string | undefined): [number, number] | undefined {
  const m = /(?:sid(?:a|an|orna)?|s\.)\s*(\d{1,4})\s*(?:-|–|till)\s*(\d{1,4})/i.exec(text ?? '')
  if (!m) return undefined
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a <= b ? [a, b] : [b, a]
}

/**
 * Segments that fit the prompt budget: a requested page range first, then the most relevant to
 * `query` (BM25 over stemmed tokens), shown in document order. Small materials pass unchanged.
 */
export function selectMaterial(m: ProcessedStudyMaterial, query: string, budget = MATERIAL_CHARS): MaterialSelection {
  const total = m.segments.reduce((n, s) => n + segLine(s).length + 1, 0)
  const range = pageRange(query)
  if (total <= budget && !range) return { material: m }
  const inRange = (s: { page: number }) => !range || (s.page >= range[0] && s.page <= range[1])
  const pool = m.segments.some(inRange) ? m.segments.filter(inRange) : m.segments
  const docs = pool.map((s) => tokens(s.text).map(stem))
  const q = [...new Set(tokens(query).map(stem))]
  const avg = docs.reduce((n, d) => n + d.length, 0) / Math.max(1, docs.length)
  const df = new Map(q.map((t) => [t, docs.filter((d) => d.includes(t)).length]))
  const score = (d: string[]) =>
    q.reduce((sum, t) => {
      const tf = d.filter((x) => x === t).length
      if (!tf) return sum
      const idf = Math.log(1 + (docs.length - df.get(t)! + 0.5) / (df.get(t)! + 0.5))
      return sum + (idf * tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * d.length) / (avg || 1)))
    }, 0)
  // Stable: equal scores keep document order, so an empty query means "from the start".
  const ranked = pool.map((s, i) => ({ s, i, sc: score(docs[i]!) })).sort((a, b) => b.sc - a.sc || a.i - b.i)
  let left = budget
  const keep = new Set<string>()
  for (const { s } of ranked) {
    const len = segLine(s).length + 1
    if (len > left) continue
    left -= len
    keep.add(s.id)
  }
  const segments = m.segments.filter((s) => keep.has(s.id))
  if (segments.length === m.segments.length) return { material: m }
  return {
    material: { ...m, segments },
    truncated: {
      pagesUsed: [...new Set(segments.map((s) => s.page))].sort((a, b) => a - b),
      segmentsUsed: segments.length,
      segmentsTotal: m.segments.length,
      ...(range ? { pageRange: range } : {}),
    },
  }
}

/** Material block; callers pass the output of `selectMaterial` (the budget here is only a guard). */
export function materialBlock(m: ProcessedStudyMaterial): string {
  let budget = MATERIAL_CHARS
  const segs: string[] = []
  for (const s of m.segments) {
    const line = segLine(s)
    if (line.length > budget) break
    budget -= line.length
    segs.push(line)
  }
  return [
    `Uppladdat studiematerial: "${m.topic}" (språk: ${m.language}).`,
    `Sammanfattning: ${m.summary}`,
    m.concepts.length ? `Begrepp: ${m.concepts.join(', ')}` : '',
    'Segment (id i hakparentes):',
    ...segs,
  ]
    .filter(Boolean)
    .join('\n')
}

export function sourceBlock(mode: SourceMode, m: ProcessedStudyMaterial | undefined): string {
  if (!m) return 'Källa: inget uppladdat material. Bygg på läroplanen och allmän, säker ämneskunskap.'
  const rules = {
    strict: [
      'Källläge STRIKT: varje uppgift och varje fakta får BARA komma från studiematerialet nedan.',
      'Varje uppgift MÅSTE ange sourceSegmentIds med minst ett segment-id som uppgiften bygger på.',
      'Fritt svar: varje punkt i rubric ska stå i de segment som anges i sourceSegmentIds (ange alla segment som punkterna bygger på).',
      'Hitta aldrig på fakta som inte står i materialet. Läroplanen används inte som källa.',
      'Ett tema eller elevens intressen får bara färga ordvalet (t.ex. namn och miljö i frågan), aldrig tillföra fakta. Rätt svar ska stå i materialet.',
    ],
    sourceAndCurriculum: [
      'Källläge MATERIAL + LÄROPLAN: studiematerialet är huvudkällan. Ange sourceSegmentIds när en uppgift bygger på materialet.',
      'Läroplanen får användas som kompletterande sammanhang.',
    ],
    extended: [
      'Källläge UTÖKAT: studiematerialet är ett startfrö för ämnet. Du får gå utöver det med korrekt ämneskunskap.',
      'Ange sourceSegmentIds när en uppgift bygger direkt på materialet.',
    ],
  }[mode]
  return [...rules, '', materialBlock(m)].join('\n')
}

export function languageBlock(subjectCode: string | undefined, m: ProcessedStudyMaterial | undefined): string {
  const lines = ['Språk: svenska är standard för instruktioner och uppgifter.']
  if (targetLanguage(subjectCode) || (m && m.language !== 'sv'))
    lines.push(
      'Detta är ett språkämne: skriv uppgiftsinnehållet på målspråket där det är pedagogiskt rätt (t.ex. glosor, läsförståelse), och sätt fältet lang (t.ex. "en"). Korta instruktioner får vara på svenska.',
    )
  return lines.join('\n')
}

/** Safety rules by age and subject: history and biology need facts about war and death, told calmly. */
export function safetyBlock(band: AgeBand, subjectCode?: string): string {
  const factual = band === 'upper' || (band === 'middle' && isFactualSubject(subjectCode))
  return [
    'Säkerhet:',
    factual
      ? '- Historiska konflikter, krig och död (t.ex. i historia, religion, samhällskunskap och biologi) behandlas sakligt och åldersanpassat, utan detaljerat våld. Inga instruktioner om vapen och inget förhärligande av våld.'
      : '- Inget våld, inga vapen, ingen strid eller krigsfokus. Behöver ämnet nämna en konflikt, gör det kort, sakligt och utan våldsdetaljer.',
    '- Intressen och teman med militära fordon och stridsflygplan behandlas bara som teknik, ingenjörskonst och flyg (t.ex. aerodynamik, motorer, historia om konstruktion), aldrig som strid.',
    '- Allt innehåll ska vara åldersanpassat, vänligt och fritt från skrämmande inslag.',
    '- Inga personuppgifter: inga riktiga namn på eleven, familj, skola eller adresser. Använd påhittade förnamn vid behov.',
  ].join('\n')
}

export function settingsBlock(p: PromptInput): string {
  return [
    `Svårighetsgrad: ${p.difficulty} av 5 (3 = som förväntat för årskursen). Sätt difficulty per uppgift nära detta.`,
    p.hints
      ? 'Ge 1–3 stegvisa ledtrådar (hints) per uppgift som leder mot svaret utan att avslöja det.'
      : 'Inga ledtrådar (hints ska vara tomma).',
    p.feedback === 'end'
      ? 'Återkoppling ges i slutet: skriv en kort förklaring (explanation) per uppgift.'
      : 'Återkoppling ges direkt efter varje svar: skriv en kort, uppmuntrande förklaring (explanation) per uppgift.',
    `Ungefärlig tid för hela passet: ${p.durationMinutes} minuter.`,
    p.subjectCode ? `Ämneskod: ${p.subjectCode}.` : '',
    p.topic ? `Område: ${p.topic}.` : '',
    p.skills?.length
      ? `skills: varje uppgift ska ha en av dessa färdighetstaggar, eller en finare undertagg av den (t.ex. "${p.skills[0]}.delmoment"): ${p.skills.join(', ')}.`
      : 'skills: korta färdighetstaggar i formatet "ämne.område.delmoment" (gemener, a-z, 0-9 och bindestreck), t.ex. "math.multiplication.tables-6-9".',
    p.knownSkills?.length
      ? `Eleven har redan dessa färdighetstaggar; återanvänd dem när de passar i stället för att hitta på nya: ${p.knownSkills.slice(0, 40).join(', ')}.`
      : '',
    p.includeImages ? 'Föreslå illustrationer (fältet illustration) där bilder hjälper.' : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/** The full system prompt: one per artifact, shared by all its calls. Never contains the learner's name. */
export function buildSystemPrompt(p: PromptInput): string {
  return [
    roleBlock(),
    ageBlock(p.school, p.band),
    `Elevprofil:\n${p.profileText}`,
    supportBlock(p.support),
    interestBlock(p.band, p.theme, p.hasInterests),
    settingsBlock(p),
    languageBlock(p.subjectCode, p.material),
    p.sourceMode === 'strict' && p.material ? '' : curriculumBlock(p.curriculum),
    sourceBlock(p.sourceMode, p.material),
    p.research && p.sourceMode !== 'strict' ? researchBlock(p.research) : '',
    safetyBlock(p.band, p.subjectCode),
  ]
    .filter(Boolean)
    .join('\n\n')
}

const KIND_SV: Record<ItemKind, string> = {
  multipleChoice: 'flerval (choices + correctIndex)',
  multiSelect: 'flera rätt (choices + correctIndexes)',
  trueFalse: 'sant/falskt',
  fillBlank: 'lucktext (text med ___ per lucka, blanks = godtagna svar per lucka)',
  matching: 'para ihop (pairs)',
  ordering: 'ordna (correctOrder i rätt ordning)',
  numeric:
    'numeriskt svar (answer, ev. unit och check som räknebart uttryck, t.ex. "7*8"; är svaret avrundat, sätt tolerance till en halv enhet i sista decimalen, t.ex. 0.05 för en decimal)',
  freeText: 'fritt svar (rubric = viktiga punkter, sampleAnswer)',
  flashcard: 'flashkort (prompt = framsida, back = baksida)',
}

export function itemsTask(opts: {
  count: number
  kinds: readonly ItemKind[]
  sectionTitle?: string
  context?: string
  avoid?: string[]
  /** Practice tests: difficulty ramp for this part, e.g. [2, 3]. */
  ramp?: [number, number]
  /** Practice tests: how many items of each kind this part should have. */
  quota?: Partial<Record<ItemKind, number>>
}): string {
  const quota = Object.entries(opts.quota ?? {}).filter(([, n]) => n)
  return [
    `Skapa exakt ${opts.count} uppgifter${opts.sectionTitle ? ` för avsnittet "${opts.sectionTitle}"` : ''}.`,
    `Tillåtna uppgiftstyper: ${opts.kinds.map((k) => KIND_SV[k]).join('; ')}. Variera typerna när flera är tillåtna.`,
    quota.length > 1
      ? `Fördelning: ${quota.map(([k, n]) => `${n} st ${KIND_SV[k as ItemKind].split(' (')[0]}`).join(', ')}.`
      : '',
    quota.length > 1 && opts.quota?.freeText ? 'Lägg uppgifterna med fritt svar sist i denna del.' : '',
    opts.ramp
      ? opts.ramp[0] === opts.ramp[1]
        ? `Svårighetsgrad (difficulty) ${opts.ramp[0]} för alla uppgifter i denna del.`
        : `Öka svårigheten gradvis: första uppgiften difficulty ${opts.ramp[0]}, sista ${opts.ramp[1]}.`
      : '',
    'Ge också en kort titel (title) för hela materialet.',
    opts.context ? `Sammanhang (redan skrivet):\n${opts.context}` : '',
    opts.avoid?.length ? `Upprepa inte dessa uppgifter:\n- ${opts.avoid.join('\n- ')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

const SECTION_SV = {
  intro: 'Introduktion: väck nyfikenhet och berätta vad passet handlar om',
  explanation: 'Förklaring: förklara begreppet tydligt',
  example: 'Exempel: ett genomräknat/genomgånget exempel steg för steg',
  practice: 'Övning',
  recap: 'Sammanfattning: de viktigaste punkterna',
  check: 'Kunskapskoll',
  text: 'Text',
  task: 'Uppgift: beskriv uppgiften tydligt',
} as const

export function textsTask(opts: {
  type: ArtifactType
  sections: { kind: keyof typeof SECTION_SV; words: number }[]
}): string {
  const what = {
    readingComprehension: 'en läsförståelsetext',
    story: 'en berättelse',
    summary: 'en sammanfattning',
    explanation: 'en förklaring',
  } as Partial<Record<ArtifactType, string>>
  return [
    `Skriv texterna till ${what[opts.type] ?? 'materialet'} med en kort titel (title).`,
    'Skriv exakt en text per avsnitt nedan, i samma ordning (bodies). Enkel markdown: stycken, listor, fetstil.',
    ...opts.sections.map((s, i) => `${i + 1}. ${SECTION_SV[s.kind]} (cirka ${s.words} ord)`),
  ].join('\n')
}

/** Rewrite the texts after a safety problem in them (bodies and title). */
export function textRepairTask(problems: string[]): string {
  return [
    'Texterna nedan underkändes vid kontrollen. Skriv om dem så att problemen försvinner, med samma avsnitt, ordning och ungefärliga längd.',
    `Problem:\n- ${problems.join('\n- ')}`,
  ].join('\n\n')
}

export function repairTask(issues: string[], items: unknown[]): string {
  return [
    `Följande ${items.length} uppgifter underkändes vid kontroll. Skapa ersättare (samma typ och samma ordning) som åtgärdar problemen.`,
    'Uppgifterna har id (t.ex. "i3") i listan nedan; problemen hänvisar till dem.',
    `Problem:\n- ${issues.join('\n- ')}`,
    `Underkända uppgifter:\n${JSON.stringify(items)}`,
  ].join('\n\n')
}

export const TRANSFORM_SV = {
  simplify: 'Förenkla språket och upplägget, behåll innehållet.',
  harder: 'Gör uppgifterna svårare (en nivå upp).',
  easier: 'Gör uppgifterna lättare (en nivå ner).',
  moreVisual: 'Gör materialet mer visuellt: mindre text, fler förslag på illustrationer.',
  changeTheme: 'Byt tema enligt det nya temat ovan.',
  shorten: 'Gör materialet kortare.',
  expand: 'Gör materialet längre med fler uppgifter.',
  more: 'Skapa nytt material av samma sort, med nya uppgifter.',
} as const
export type TransformKind = keyof typeof TRANSFORM_SV

export function transformContext(kind: TransformKind, previous: string): string {
  return `Omarbetning: ${TRANSFORM_SV[kind]}\nTidigare version (utgå från den):\n${previous}`
}

export function interpretSystem(subjects: { code: string; name: string }[]): string {
  return [
    'Du tolkar en förfrågan om läromaterial till strukturerade fält. Fyll bara i det som tydligt framgår; lämna resten tomt.',
    'type: practiceTest | exercises | lesson | revision | worksheet | flashcards | readingComprehension | explanation | summary | story | writingPrompt | project',
    'stage: forskoleklass | grundskola | gymnasieskola. year: årskurs (0 för förskoleklass, 1–9 grundskola, 1–3 gymnasiet).',
    'itemKinds: multipleChoice | multiSelect | trueFalse | fillBlank | matching | ordering | numeric | freeText | flashcard',
    'textAmount: minimal | reduced | normal. visualSupport: high | normal | low. feedback: immediate | end.',
    'difficulty 1–5 (3 = som förväntat). questionCount 1–60. durationMinutes 3–120. maxChoices 2–6.',
    subjects.length
      ? `subjectCode: välj bara bland: ${subjects.map((s) => `${s.code} (${s.name})`).join(', ')}`
      : 'subjectCode: lämna tomt.',
    'theme: elevens önskade tema (t.ex. "tåg"). topic: ämnesområdet (t.ex. "multiplikation").',
  ].join('\n')
}
