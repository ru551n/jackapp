import { createContext, useContext, useEffect, useState } from 'react'
import { learnerApi, type LearnerView, type Subject } from './api'
import type { PresentationFlags } from './presentation'

export const LearnerContext = createContext<{ learner: LearnerView; flags: PresentationFlags } | null>(null)

export function useLearner() {
  const ctx = useContext(LearnerContext)
  if (!ctx) throw new Error('useLearner outside LearnerArea')
  return ctx
}

/** Fetch once per key; `undefined` while loading, `null` on any failure (learners never see why). */
export function useFetch<T>(load: () => Promise<T>, key: string): T | null | undefined {
  const [state, setState] = useState<{ key: string; value: T | null }>()
  useEffect(() => {
    let live = true
    load().then(
      (value) => live && setState({ key, value }),
      () => live && setState({ key, value: null }),
    )
    return () => {
      live = false
    }
    // `load` is a fresh closure every render; `key` identifies the request.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state?.key === key ? state.value : undefined
}

export const useSubjects = () => {
  const { learner } = useLearner()
  const { stage, year } = learner.school
  return useFetch<Subject[]>(() => learnerApi.subjects(learner.school), `subjects:${stage}:${year}`)
}
