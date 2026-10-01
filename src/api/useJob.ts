import { useEffect, useState } from 'react'
import { API_PREFIX, type JobStatus } from '../../shared/contracts'
import { api } from './client'

const FINAL = new Set(['completed', 'failed', 'cancelled'])

/**
 * Follow a background job: Server-Sent Events, falling back to calm polling (every 3 s) if the
 * stream is unavailable. Returns the latest status (undefined until the first one arrives).
 */
export function useJob(jobId: string | undefined): JobStatus | undefined {
  const [status, setStatus] = useState<JobStatus>()
  useEffect(() => {
    if (!jobId) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      if (stopped) return
      const s = await api.get<JobStatus>(`/jobs/${jobId}`).catch(() => undefined)
      if (s) setStatus(s)
      if (!s || !FINAL.has(s.state)) timer = setTimeout(poll, 3000)
    }
    if (typeof EventSource === 'undefined') {
      void poll()
    } else {
      const es = new EventSource(`${API_PREFIX}/jobs/${jobId}/events`)
      es.addEventListener('status', (e) => {
        const s = JSON.parse((e as MessageEvent).data) as JobStatus
        setStatus(s)
        if (FINAL.has(s.state)) es.close()
      })
      es.onerror = () => {
        es.close()
        void poll()
      }
      return () => {
        stopped = true
        es.close()
        clearTimeout(timer)
      }
    }
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [jobId])
  return status
}
