// Core contracts shared by the engine, content and UI. Change only via the orchestrator.

export type AreaId = 'stationen' | 'tunnelbanan' | 'sparvagnen' | 'flygplatsen' | 'engelska'

export type SkillId =
  // Stationen — reading
  | 'read.letters'
  | 'read.words'
  | 'read.missingLetter'
  | 'read.sentences'
  // Tunnelbanan — mathematics
  | 'math.count'
  | 'math.compare'
  | 'math.oneMoreLess'
  | 'math.sequence'
  | 'math.add'
  | 'math.sub'
  // Spårvagnen — patterns and logic
  | 'logic.pattern'
  | 'logic.order'
  | 'logic.category'
  // Flygplatsen — aviation reading, numbers and recognition
  | 'air.recognize'
  | 'air.read'
  | 'air.numbers'
  | 'air.compare'
  // Engelska — beginner English through transport (UI stays Swedish)
  | 'en.words'
  | 'en.colors'
  | 'en.numbers'
  | 'en.adjectives'
  | 'en.listen'
  | 'en.sentences'

export type Level = 1 | 2 | 3 | 4 | 5
export const MIN_LEVEL: Level = 1
export const MAX_LEVEL: Level = 5

/** 'extra' = the child has struggled recently; generators should show stronger visual support up front. */
export type Support = 'normal' | 'extra'

/** Languages the app can speak: Swedish UI, English as a learned subject. */
export type SpeechLang = 'sv' | 'en'

export type Theme = 'train' | 'metro' | 'tram' | 'airport' | 'fighter'

/** Calm palette tints usable on sprites (patterns, categories). */
export type Tint = 'red' | 'blue' | 'green' | 'yellow' | 'grey'

export type SpriteId =
  | 'locomotive'
  | 'carriage'
  | 'metroCar'
  | 'tram'
  | 'passenger'
  | 'suitcase'
  | 'airliner'
  | 'jet'
  | 'signal'
  | 'station'
  | 'bus'
  | 'car'

export interface SceneItem {
  sprite: SpriteId
  tint?: Tint
  /** leaving = shown faded with an exit marker; arriving = outlined as new; faded = de-emphasised. */
  state?: 'normal' | 'leaving' | 'arriving' | 'faded'
  /** Items with different group numbers are drawn with a visible gap between groups. */
  group?: number
}

export type SignStyle = 'platform' | 'departure' | 'gate' | 'station' | 'word'

export type EquationTerm = number | '+' | '−' | '=' | '?'

/** Declarative visuals. Content describes WHAT to show; the UI decides HOW. */
export type Scene =
  | { kind: 'row'; items: SceneItem[]; label?: string }
  | { kind: 'sign'; text: string; style: SignStyle }
  /** scale (0.2–1) draws the vehicle relative to the largest in the task, for size comparisons. */
  | { kind: 'vehicle'; vehicle: string; view?: 'art' | 'silhouette'; scale?: number }
  | { kind: 'number'; value: number }
  | { kind: 'equation'; terms: EquationTerm[] }
  | { kind: 'text'; text: string; size?: 'md' | 'lg' | 'xl' }
  | { kind: 'group'; direction: 'row' | 'column'; scenes: Scene[] }

export interface Choice {
  id: string
  label?: string
  visual?: Scene
  /** Accessible name when the label alone is not descriptive (e.g. a picture-only choice). */
  ariaLabel?: string
}

export type Task =
  | { kind: 'choice'; choices: Choice[]; answer: string }
  /** Tap items in order; answer lists choice ids in the correct order. */
  | { kind: 'order'; items: Choice[]; answer: string[] }

export interface Hint {
  text: string
  /** Replaces the question scene with a more supportive representation. */
  scene?: Scene
  /** Choice ids to remove, making the task easier. Never includes the answer. */
  eliminate?: string[]
}

export interface Question {
  /** Stable id derived from content (not the seed), used to avoid repeats. */
  id: string
  skill: SkillId
  level: Level
  theme: Theme
  /** Short Swedish prompt, shown and (optionally) spoken. */
  prompt: string
  /** Spoken text when it should differ from the prompt (e.g. reading out "3 + 1"). Always Swedish. */
  speech?: string
  /** Target-language audio (e.g. the English word "train"), offered on its own speaker button. */
  listen?: { text: string; lang: SpeechLang }
  scene?: Scene
  task: Task
  /** Progressive hints: hints[0] after the first miss, hints[1] after the second, ... */
  hints: Hint[]
  /** Short calm confirmation shown on success, e.g. "Tåget har fem vagnar." */
  success?: string
}

export interface Rng {
  /** Float in [0, 1). */
  next(): number
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number
  pick<T>(items: readonly T[]): T
  shuffle<T>(items: readonly T[]): T[]
}

export interface GenContext {
  rng: Rng
  level: Level
  support: Support
}

/** One activity type. Several generators may share a skill. */
export interface Generator {
  id: string
  skill: SkillId
  /** Inclusive level range this generator is suitable for. */
  levels: [Level, Level]
  generate(ctx: GenContext): Question
}

// ---- Progress and persisted state ----

/** first = correct on first try; retry = after one miss; helped = after two or more misses. */
export type Outcome = 'first' | 'retry' | 'helped'

export interface SkillProgress {
  level: Level
  attempts: number
  firstTry: number
  hintsUsed: number
  /** Newest last; bounded window used by the adaptation rules. */
  recent: Outcome[]
  /** Set by a parent: automatic level changes are paused. */
  levelLocked?: boolean
  lastPracticed?: number
}

export interface SessionLog {
  at: number
  area: AreaId
  skills: SkillId[]
  firstTry: number
  total: number
}

export interface Settings {
  /** Soft sound effects. Off by default. */
  sound: boolean
  /** Show the "Lyssna" button that reads prompts aloud. Never autoplays. */
  speech: boolean
  motion: 'system' | 'reduced' | 'full'
  freePlayEnabled: boolean
}

export type LineVehicle = 'train' | 'metro' | 'tram'

export interface FreeStation {
  id: string
  name: string
  /** Position in a 0..100 coordinate space. */
  x: number
  y: number
}

export interface FreeLine {
  stations: FreeStation[]
  vehicle: LineVehicle
}

export interface AppState {
  version: 1
  progress: Partial<Record<SkillId, SkillProgress>>
  /** Completed sessions ("uppdrag") per area. Drives unlocks. */
  missions: Record<AreaId, number>
  /** Monotonic counter used to seed sessions deterministically. */
  sessionCounter: number
  recentQuestionIds: string[]
  sessions: SessionLog[]
  settings: Settings
  /** Plain local PIN for the parent gate; undefined until the parent sets one. */
  parentPin?: string
  freePlay: { line: FreeLine | null }
}

// ---- Vehicles (collection + content) ----

export type VehicleCategory = 'train' | 'metro' | 'tram' | 'airliner' | 'fighter'

export interface Vehicle {
  id: string
  /** Full name, e.g. "Saab JAS 39 Gripen". */
  name: string
  /** Name a child reads in tasks, e.g. "Gripen". */
  shortName: string
  category: VehicleCategory
  /** Country of origin in Swedish, e.g. "Sverige". */
  country: string
  swedish: boolean
  /** 2–4 short, verified, child-friendly Swedish sentences. */
  facts: string[]
  specs: {
    firstYear?: number
    engines?: number
    lengthM?: number
    wingspanM?: number
    topSpeedKmh?: number
  }
  /** Where the facts were verified (not shown to the child). */
  sources: string[]
  /** Unlocked when missions in `area` (or total, for 'any') reach `missions`. */
  unlock: { area: AreaId | 'any'; missions: number }
}
