import type {
  AgeBand,
  ArtifactType,
  ItemKind,
  ProcessedStudyMaterial,
  SchoolPosition,
  SourceMode,
  SupportPreferences,
} from '../../../shared/contracts'

// Versioned prompt building blocks (docs/platform/generation.md#prompt-architecture).
// Bump PROMPT_VERSION whenever wording changes; it is stored on every artifact version.
export const PROMPT_VERSION = 'generation/v3'

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

const MATERIAL_CHARS = 14_000

export function materialBlock(m: ProcessedStudyMaterial): string {
  // ponytail: plain truncation of long material; rank segments by relevance if sets get large.
  let budget = MATERIAL_CHARS
  const segs: string[] = []
  for (const s of m.segments) {
    const line = `[${s.id}] (sida ${s.page}, ${s.kind}) ${s.text}`
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
      'Hitta aldrig på fakta som inte står i materialet. Läroplanen används inte som källa.',
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

const LANGUAGE_SUBJECT = /ENG|MOD|SPA|TYS|FRA|ENGE|ENGN/i

export function languageBlock(subjectCode: string | undefined, m: ProcessedStudyMaterial | undefined): string {
  const lines = ['Språk: svenska är standard för instruktioner och uppgifter.']
  if ((subjectCode && LANGUAGE_SUBJECT.test(subjectCode)) || (m && m.language !== 'sv'))
    lines.push(
      'Detta är ett språkämne: skriv uppgiftsinnehållet på målspråket där det är pedagogiskt rätt (t.ex. glosor, läsförståelse), och sätt fältet lang (t.ex. "en"). Korta instruktioner får vara på svenska.',
    )
  return lines.join('\n')
}

export function safetyBlock(): string {
  return [
    'Säkerhet:',
    '- Inget våld, inga vapen, ingen strid eller krigsfokus. Militära fordon och stridsflygplan behandlas bara som teknik, ingenjörskonst och flyg (t.ex. aerodynamik, motorer, historia om konstruktion).',
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
      : 'skills: korta färdighetstaggar i formatet "ämne.område.delmoment", t.ex. "math.multiplication.tables-6-9".',
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
    safetyBlock(),
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
  numeric: 'numeriskt svar (answer, ev. unit och check som räknebart uttryck, t.ex. "7*8")',
  freeText: 'fritt svar (rubric = viktiga punkter, sampleAnswer)',
  flashcard: 'flashkort (prompt = framsida, back = baksida)',
}

export function itemsTask(opts: {
  count: number
  kinds: readonly ItemKind[]
  sectionTitle?: string
  context?: string
  avoid?: string[]
}): string {
  return [
    `Skapa exakt ${opts.count} uppgifter${opts.sectionTitle ? ` för avsnittet "${opts.sectionTitle}"` : ''}.`,
    `Tillåtna uppgiftstyper: ${opts.kinds.map((k) => KIND_SV[k]).join('; ')}. Variera typerna när flera är tillåtna.`,
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

export function repairTask(issues: string[], items: unknown[]): string {
  return [
    `Följande ${items.length} uppgifter underkändes vid kontroll. Skapa ersättare (samma typ och samma ordning) som åtgärdar problemen.`,
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
