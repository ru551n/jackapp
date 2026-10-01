import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router'
import { paths } from '../../app/paths'
import { areaById, type AreaInfo } from '../../core/catalog'
import { hashSeed } from '../../core/rng'
import type { AreaId, Question, SkillId, Vehicle } from '../../core/types'
import { AVAILABLE_SKILLS, GENERATORS } from '../../content'
import { newlyUnlocked } from '../../content/vehicles'
import { nextQuestion, planSession } from '../../engine/session'
import { stopSpeaking } from '../../lib/speech'
import { actions, getState } from '../../store/store'
import { Shell } from '../../ui/Shell'
import { DonePanel } from './DonePanel'
import { Exercise } from './Exercise'
import { RouteProgress } from './RouteProgress'

interface Run {
  seed: number
  plan: SkillId[]
  index: number
  question: Question | null
  firstTry: number
  unlocked: Vehicle[]
  done: boolean
}

function makeQuestion(plan: SkillId[], seed: number, index: number): Question {
  const s = getState()
  return nextQuestion(GENERATORS, plan[index], s, hashSeed(seed, index), s.recentQuestionIds)
}

function startRun(area: AreaId): Run {
  const s = getState()
  const seed = s.sessionCounter + 1
  const plan = planSession(area, s, AVAILABLE_SKILLS)
  return {
    seed,
    plan,
    index: 0,
    question: plan.length ? makeQuestion(plan, seed, 0) : null,
    firstTry: 0,
    unlocked: [],
    done: false,
  }
}

export function SessionPage() {
  const { area: areaParam = '' } = useParams()
  const area = areaById(areaParam)
  if (!area) return <Navigate to={paths.home} replace />
  // Keyed so switching area always starts a fresh session.
  return <Session key={area.id} area={area} />
}

function Session({ area }: { area: AreaInfo }) {
  const [run, setRun] = useState<Run>(() => startRun(area.id))

  useEffect(() => stopSpeaking, [])

  const onDone = (misses: number, hintsShown: number) => {
    const q = run.question!
    stopSpeaking()
    actions.recordAnswer(q.skill, q.id, misses, hintsShown)
    const firstTry = run.firstTry + (misses === 0 ? 1 : 0)
    const index = run.index + 1
    if (index < run.plan.length) {
      setRun({ ...run, index, firstTry, question: makeQuestion(run.plan, run.seed, index) })
      return
    }
    const before = getState().missions
    actions.completeSession({
      at: Date.now(),
      area: area.id,
      skills: [...new Set(run.plan)],
      firstTry,
      total: run.plan.length,
    })
    setRun({ ...run, index, firstTry, done: true, unlocked: newlyUnlocked(before, getState().missions) })
  }

  return (
    <Shell title={area.name}>
      <RouteProgress total={run.plan.length} current={run.index} />
      {run.done ? (
        <DonePanel area={area.id} unlocked={run.unlocked} onAgain={() => setRun(startRun(area.id))} />
      ) : run.question ? (
        <Exercise
          key={`${run.seed}:${run.index}`}
          question={run.question}
          onDone={onDone}
          nextLabel={run.index + 1 < run.plan.length ? 'Nästa' : 'Klart'}
        />
      ) : (
        <p>Här finns inga uppgifter än.</p>
      )}
    </Shell>
  )
}
