import { useCallback, useEffect, useState } from 'react'
import type {
  AgeBand,
  Artifact,
  CurriculumRef,
  GateState,
  GenerationRequest,
  LearnerProfile,
  LearningPath,
  SchoolPosition,
  SkillSummary,
  StudySet,
  SystemStatus,
  ValidationReport,
} from '../../../shared/contracts'
import { api, ApiRequestError } from '../../api/client'

// Data access for the adult area. A 403 adult_required anywhere re-shows the gate (event below).

export const ADULT_REQUIRED_EVENT = 'jackapp:adult-required'

function watch<T>(p: Promise<T>): Promise<T> {
  return p.catch((e: unknown) => {
    if (e instanceof ApiRequestError && e.status === 403 && e.code === 'adult_required')
      window.dispatchEvent(new Event(ADULT_REQUIRED_EVENT))
    throw e
  })
}

/** Same as `api`, but notices when the adult window has closed. */
export const adultApi = {
  get: <T>(path: string) => watch(api.get<T>(path)),
  post: <T>(path: string, body?: unknown) => watch(api.post<T>(path, body)),
  patch: <T>(path: string, body: unknown) => watch(api.patch<T>(path, body)),
  del: (path: string) => watch(api.del(path)),
}

export interface Resource<T> {
  data?: T
  error?: ApiRequestError
  loading: boolean
  reload: () => void
  set: (data: T) => void
}

/** GET a path (null = skip); refetches when the path changes or on reload(). Keeps old data while reloading. */
export function useResource<T>(path: string | null): Resource<T> {
  const [state, setState] = useState<{ data?: T; error?: ApiRequestError; key?: string }>({})
  const [n, setN] = useState(0)
  const key = `${n}:${path}`
  useEffect(() => {
    if (!path) return
    let live = true
    adultApi.get<T>(path).then(
      (data) => live && setState({ data, key }),
      (e: unknown) =>
        live &&
        setState({
          key,
          error: e instanceof ApiRequestError ? e : new ApiRequestError(0, 'network', 'Det gick inte att hämta.'),
        }),
    )
    return () => {
      live = false
    }
  }, [path, key])
  const reload = useCallback(() => setN((x) => x + 1), [])
  const set = useCallback((data: T) => setState((s) => ({ ...s, data, error: undefined })), [])
  return { data: state.data, error: state.error, loading: !!path && state.key !== key, reload, set }
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Något gick fel. Försök igen.')

// Response shapes not in shared/contracts (taken from the server routes).
export interface LearnerListItem {
  id: string
  displayName: string
  school: SchoolPosition
  ageBand: AgeBand
}
export interface Pattern {
  code: string
  skill?: string
  note: string
}
export interface SkillsResponse {
  skills: SkillSummary[]
  patterns: Pattern[]
}
export interface NextStep {
  kind: 'remediate' | 'review' | 'continuePath' | 'explore'
  title: string
  reason: string
  skill?: string
  pathId?: string
  request: GenerationRequest
}
export interface ArtifactSummary {
  id: string
  type: Artifact['type']
  title: string
  subjectCode?: string | null
  approval: Artifact['approval']
  version: number
  createdBy: Artifact['createdBy']
  createdAt: string
  updatedAt: string
}
export interface ArtifactResponse {
  artifact: Artifact
  requestedIllustrations: { itemId: string; description: string }[]
}
export interface VersionEntry {
  version: number
  origin: string
  validation: ValidationReport
  createdAt: string
}
export interface Subject {
  code: string
  name: string
}
export interface SuggestedRef {
  ref: CurriculumRef
  subjectName: string
  kind: string
  area: string | null
  text: string
}
export interface Attribution {
  attributionRequired: boolean
  attribution?: string
  license: string
  licenseUrl?: string
  creator?: string
  sourceUrl?: string
  provider: string
  generated: boolean
}
export interface LegacyImportResult {
  importId: string
  created: boolean
  skills: number
  skipped: string[]
}

export const paths = {
  gate: '/gate',
  status: '/system/status',
  learners: '/learners',
  learner: (id: string) => `/learners/${id}`,
  skills: (id: string) => `/learners/${id}/skills`,
  next: (id: string) => `/learners/${id}/next`,
  learningPaths: (id: string) => `/learners/${id}/paths`,
  artifacts: (id: string, q = '') => `/learners/${id}/artifacts${q}`,
  artifact: (id: string) => `/artifacts/${id}`,
  studySets: (id: string) => `/learners/${id}/study-sets`,
  subjects: (s: SchoolPosition) => `/curriculum/subjects?stage=${s.stage}&year=${s.year}`,
}

export type {
  Artifact,
  GateState,
  LearnerProfile,
  LearningPath,
  SkillSummary,
  StudySet,
  SystemStatus,
  GenerationRequest,
}
