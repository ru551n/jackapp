import { useCallback, useEffect, useRef, useState } from 'react'
import type { FreeStation } from '../../core/types'
import { stationOffsets } from './model'

const SPEED = 12 // map units per second: calm and constant
const DWELL_MS = 1600

export function prefersReducedMotion() {
  const m = document.documentElement.dataset.motion
  if (m === 'reduced') return true
  if (m === 'full') return false
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Vehicle position as distance along the route; `at` is the index of the station stopped at (or null). */
export function useRunner(stations: FreeStation[], reduced: boolean) {
  const [run, setRun] = useState({ d: 0, at: 0 as number | null, to: 1, running: false })
  const offs = stationOffsets(stations)
  const offsRef = useRef(offs)
  offsRef.current = offs
  const n = stations.length

  const stop = useCallback(() => setRun((r) => ({ ...r, running: false })), [])
  const start = useCallback(() => setRun({ d: 0, at: 0, to: 1, running: true }), [])
  /** Reduced motion: jump to the next station (wraps to the first). */
  const step = useCallback(
    () =>
      setRun((r) => {
        const next = r.at === null || r.at >= n - 1 ? 0 : r.at + 1
        return { d: offsRef.current[next] ?? 0, at: next, to: next + 1, running: false }
      }),
    [n],
  )

  // Keep position valid when stations are added or removed.
  useEffect(() => setRun({ d: 0, at: 0, to: 1, running: false }), [n])

  const running = run.running && !reduced
  useEffect(() => {
    if (!running) return
    let raf = 0
    let last = performance.now()
    let hold = last + DWELL_MS
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      if (now >= hold) {
        setRun((r) => {
          const o = offsRef.current
          const target = r.to
          const nd = r.d + SPEED * dt
          if (nd >= o[target]) {
            hold = now + DWELL_MS
            return { d: o[target], at: target, to: target + 1, running: target < o.length - 1 }
          }
          return { d: nd, at: null, to: r.to, running: true }
        })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [running])

  return { ...run, running, start, stop, step }
}
