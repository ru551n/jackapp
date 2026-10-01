import { useEffect, useRef, useState } from 'react'
import type { CreationJob } from '../../shared/contracts'
import { api } from './client'

/** Fired after something was queued, so lists and badges refetch at once. */
export const JOBS_CHANGED_EVENT = 'jackapp:jobs-changed'
export const jobsChanged = () => window.dispatchEvent(new Event(JOBS_CHANGED_EVENT))

export const isActive = (j: CreationJob) => j.state === 'queued' || j.state === 'processing'

/**
 * A creation job list (`GET /learners/:id/jobs` or `GET /jobs`), refetched every `activeMs` while any
 * job is active and every `idleMs` otherwise (never, by default). Paused while the tab is hidden.
 * ponytail: one poll per list instead of SSE per row; fine for a household-sized queue.
 */
export function useJobList(
  path: string,
  { activeMs = 3000, idleMs }: { activeMs?: number; idleMs?: number } = {},
): CreationJob[] | undefined {
  const [list, setList] = useState<{ path: string; jobs: CreationJob[] }>()
  const [n, setN] = useState(0)
  const busy = useRef(false)

  useEffect(() => {
    const bump = () => setN((x) => x + 1)
    const visible = () => !document.hidden && bump()
    window.addEventListener(JOBS_CHANGED_EVENT, bump)
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.removeEventListener(JOBS_CHANGED_EVENT, bump)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [])

  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    // Hidden tabs stop here; becoming visible bumps `n` and starts again.
    const next = () => {
      const ms = busy.current ? activeMs : idleMs
      if (live && ms && !document.hidden) timer = setTimeout(load, ms)
    }
    const load = () =>
      api.get<CreationJob[]>(path).then(
        (jobs) => {
          if (!live) return
          setList({ path, jobs })
          busy.current = jobs.some(isActive)
          next()
        },
        next, // keep following through a hiccup
      )
    void load()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [path, activeMs, idleMs, n])

  return list?.path === path ? list.jobs : undefined
}

/** One learner's creation jobs; `activeOnly` for badges. */
export const useCreationJobs = (learnerId: string, activeOnly = false) =>
  useJobList(`/learners/${learnerId}/jobs${activeOnly ? '?active=1' : ''}`)
