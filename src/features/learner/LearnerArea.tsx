import { useEffect, useLayoutEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ApiRequestError } from '../../api/client'
import type { Settings } from '../../core/types'
import { learnerKey } from '../../store/state'
import { actions, getState, selectLearner, useSelectedKey } from '../../store/store'
import { bandOf, learnerApi, type LearnerView } from './api'
import { LearnerContext } from './context'
import { EarlyArea } from './early/EarlyArea'
import { MiddleArea } from './middle/MiddleArea'
import { usePresentation } from './presentation'
import { UpperArea } from './upper/UpperArea'
import styles from './learner.module.css'

// `/l/:learnerId/*`: loads the learner view, selects their local store and picks the age-band experience.

const cacheKey = (id: string) => `jackapp:profile:${id}`

function cached(id: string): LearnerView | undefined {
  try {
    return JSON.parse(localStorage.getItem(cacheKey(id)) ?? 'null') ?? undefined
  } catch {
    return undefined
  }
}

type Load = LearnerView | 'loading' | 'missing' | 'offline'

export function LearnerArea() {
  const { learnerId = '' } = useParams()
  const [load, setLoad] = useState<{ id: string; value: Load }>({ id: learnerId, value: 'loading' })
  const selected = useSelectedKey()

  // Select before any early-years screen reads the store (a session seeds itself on first render).
  useLayoutEffect(() => {
    selectLearner(learnerId)
    return () => selectLearner(undefined)
  }, [learnerId])

  useEffect(() => {
    let live = true
    learnerApi.profile(learnerId).then(
      (p) => {
        try {
          localStorage.setItem(cacheKey(learnerId), JSON.stringify(p))
        } catch {
          // Storage blocked: fine, just no offline fallback.
        }
        if (live) setLoad({ id: learnerId, value: p })
      },
      (e: unknown) => {
        const gone = e instanceof ApiRequestError && (e.status === 404 || e.status === 400)
        if (live) setLoad({ id: learnerId, value: gone ? 'missing' : (cached(learnerId) ?? 'offline') })
      },
    )
    return () => {
      live = false
    }
  }, [learnerId])

  const value = load.id === learnerId ? load.value : 'loading'
  if (typeof value === 'string') return <Waiting state={value} />
  if (selected !== learnerKey(learnerId)) return <Waiting state="loading" />
  return <LearnerRoot key={learnerId} learner={value} />
}

function Waiting({ state }: { state: 'loading' | 'missing' | 'offline' }) {
  return (
    <main className={styles.waiting}>
      {state === 'loading' ? (
        <p role="status">Ett ögonblick …</p>
      ) : (
        <>
          <p>{state === 'missing' ? 'Den här eleven finns inte här.' : 'Det går inte att öppna JackApp just nu.'}</p>
          <Link to="/" className={styles.plainLink}>
            Byt elev
          </Link>
        </>
      )}
    </main>
  )
}

function LearnerRoot({ learner }: { learner: LearnerView }) {
  const flags = usePresentation({ ...learner.presentation, ageBand: bandOf(learner) })

  // Server support preferences drive the early-years settings; the stored copy is the offline fallback.
  const { sound, readAloud, reducedMotion } = learner.presentation
  const freePlay = learner.freePlayEnabled
  useLayoutEffect(() => {
    const patch: Partial<Settings> = { sound, speech: readAloud, motion: reducedMotion ? 'reduced' : 'system' }
    if (freePlay !== undefined) patch.freePlayEnabled = freePlay
    const cur = getState().settings
    if (Object.entries(patch).some(([k, v]) => cur[k as keyof Settings] !== v)) actions.updateSettings(patch)
  }, [sound, readAloud, reducedMotion, freePlay])

  const Area = flags.band === 'early' ? EarlyArea : flags.band === 'middle' ? MiddleArea : UpperArea
  return (
    <LearnerContext.Provider value={{ learner, flags }}>
      <div className={styles.root} {...flags.rootProps}>
        <Area />
      </div>
    </LearnerContext.Provider>
  )
}
