import type {
  AgeBand,
  ArtifactType,
  GenerationRequest,
  LearningPath,
  SchoolPosition,
  StudySet,
  SupportPreferences,
} from '../../../shared/contracts'
import { ageBand } from '../../../shared/contracts'
import { api } from '../../api/client'

// Learner-mode API shapes (see docs/platform/{learners,generation,adaptive,uploads}.md).

export type Presentation = SupportPreferences & { ageBand: AgeBand; school: SchoolPosition }

/** `GET /learners/:id` without the adult gate. */
export interface LearnerView {
  id: string
  displayName: string
  school: SchoolPosition
  ageBand?: AgeBand
  language: string
  presentation: Presentation
  learnerRequestsAllowed: boolean
  interests?: string[]
  themes?: string[]
  freePlayEnabled?: boolean
}

export interface ArtifactSummary {
  id: string
  type: ArtifactType
  title: string
  subjectCode?: string | null
  createdAt: string
}

/** Child-friendly next step. */
export interface ChildStep {
  kind: string
  title: string
  text: string
  pathId?: string
}

export interface Subject {
  code: string
  name: string
  courses?: { code: string; name: string }[]
}

/** The calm message learners see for every failure to create material. */
export const CALM_FAILURE = 'Det gick inte att skapa uppgiften just nu.'

export const bandOf = (l: Pick<LearnerView, 'ageBand' | 'school'>): AgeBand => l.ageBand ?? ageBand(l.school)

export type LearnerRequest = Omit<Partial<GenerationRequest>, 'learnerId'>

export const learnerApi = {
  profile: (id: string) => api.get<LearnerView>(`/learners/${id}`),
  artifacts: (id: string) => api.get<ArtifactSummary[]>(`/learners/${id}/artifacts`),
  next: (id: string) => api.get<ChildStep[]>(`/learners/${id}/next`),
  paths: (id: string) => api.get<LearningPath[]>(`/learners/${id}/paths`),
  studySets: (id: string) => api.get<StudySet[]>(`/learners/${id}/study-sets`),
  subjects: (s: SchoolPosition) =>
    api.get<{ subjects: Subject[] }>(`/curriculum/subjects?stage=${s.stage}&year=${s.year}`).then((r) => r.subjects),
  generate: (id: string, req: LearnerRequest) => api.post<{ jobId: string }>(`/learners/${id}/generate`, req),
  plan: (id: string, body: { goal: string; targetDate?: string; studySetId?: string }) =>
    api.post<{ jobId: string }>(`/learners/${id}/paths`, body),
  /** Learners get 404 until the material is approved. */
  artifact: (artifactId: string) =>
    api.get<{ artifact: { id: string; title: string; subjectCode?: string } }>(`/artifacts/${artifactId}`),
}

export const TYPE_LABEL: Record<ArtifactType, string> = {
  practiceTest: 'Övningsprov',
  exercises: 'Övningar',
  lesson: 'Lektion',
  revision: 'Repetition',
  worksheet: 'Arbetsblad',
  flashcards: 'Kort',
  readingComprehension: 'Läsförståelse',
  explanation: 'Förklaring',
  summary: 'Sammanfattning',
  story: 'Berättelse',
  writingPrompt: 'Skrivuppgift',
  project: 'Projekt',
}
