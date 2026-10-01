import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useAppState } from '../../store/store'
import type { FreeStation } from '../../core/types'
import { stationOffsets } from './model'

const SPEED = 9 // map units per second: calm and constant
const DWELL_MS = 1600

const QUERY = '(prefers-reduced-motion: reduce)'
const subscribe = (cb: () => void) => {
  if (typeof matchMedia !== 'function') return () => {}
  const m = matchMedia(QUERY)
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}
const systemReduced = () => typeof matchMedia === 'function' && matchMedia(QUERY).matches

/** Reduced motion from the motion setting; 'system' follows the OS and reacts to changes. */
export function useReducedMotion() {
  const motion = useAppState((s) => s.settings.motion)
  const system = useSyncExternalStore(subscribe, systemReduced, () => false)
  return motion === 'system' ? system : motion === 'reduced'
}

const IDLE = { d: 0, at: 0 as number | null, to: 1, running: false }

/** Vehicle position as distance along the route; `at` is the index of the station stopped at (or null). */
export function useRunner(stations: FreeStation[], reduced: boolean) {
  const [run, setRun] = useState(IDLE)
  const n = stations.length
  // Reset when stations are added or removed (adjusting state during render, no effect needed).
  const [prevN, setPrevN] = useState(n)
  if (prevN !== n) {
    setPrevN(n)
    setRun(IDLE)
  }
  const offs = stationOffsets(stations)
  const offsRef = useRef(offs)
  useEffect(() => {
    offsRef.current = offs
  })

  const stop = useCallback(() => setRun((r) => ({ ...r, running: false })), [])
  const start = useCallback(() => setRun({ ...IDLE, running: true }), [])
  /** Reduced motion: jump to the next station (wraps to the first). */
  const step = useCallback(
    () =>
      setRun((r) => {
        const next = r.at === null || r.at >= n - 1 ? 0 : r.at + 1
        return { d: offs[next] ?? 0, at: next, to: next + 1, running: false }
      }),
    [n, offs],
  )

  const running = run.running && !reduced
  useEffect(() => {
    if (!running) return
    // The loop owns its position locally and publishes snapshots; always starts from the first station.
    let raf = 0
    let last = performance.now()
    let hold = last + DWELL_MS
    let d = 0
    let to = 1
    const tick = (now: number) => {
      const o = offsRef.current
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      if (now >= hold) {
        d += SPEED * dt
        if (d >= o[to]) {
          d = o[to]
          const done = to >= o.length - 1
          setRun({ d, at: to, to: to + 1, running: !done })
          if (done) return
          to += 1
          hold = now + DWELL_MS
        } else {
          setRun({ d, at: null, to, running: true })
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [running])

  return { ...run, running, start, stop, step }
}
