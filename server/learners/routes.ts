import { eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  ageBand,
  defaultGeneration,
  LearnerProfileInput,
  SchoolPosition,
  type LearnerProfile,
} from '../../shared/contracts'
import type { RouteModule } from '../app/context'
import { learners } from '../db/schema'
import { HttpError, requireAdult, requireLearner } from '../gate/guards'
import { applySettingChanges, importLegacy, LegacyAppState, legacySettingChanges } from './legacy'
import { cleanList, presentationFor, unsafeThemes } from './profile'

type Row = typeof learners.$inferSelect

const Params = z.object({ id: z.string().uuid() })

const full = (l: Row): LearnerProfile => ({
  ...l.profile,
  id: l.id,
  createdAt: l.createdAt.toISOString(),
  updatedAt: l.updatedAt.toISOString(),
})

/** What a learner screen needs: no strengths, difficulties, levels or approval policy. */
const learnerView = (l: Row) => ({
  id: l.id,
  displayName: l.profile.displayName,
  school: l.profile.school,
  ageBand: ageBand(l.profile.school),
  language: l.profile.language,
  presentation: presentationFor(l.profile),
  learnerRequestsAllowed: l.profile.generation.learnerRequestsAllowed,
  // Themes for guided requests and the early-years free-play switch (not sensitive).
  interests: l.profile.interests,
  themes: l.profile.themes,
  freePlayEnabled: l.profile.freePlayEnabled,
})

function validProfile(input: unknown): LearnerProfileInput {
  const p = LearnerProfileInput.parse(input)
  p.interests = cleanList(p.interests)
  p.themes = cleanList(p.themes)
  const bad = unsafeThemes([...p.interests, ...p.themes])
  if (bad.length) throw new HttpError(400, 'unsafe_theme', 'Ett av intressena eller temana passar inte i JackApp.')
  return p
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** New learners get the age-band generation defaults (F–3: adult approval) under what the caller sent. */
function withAgeDefaults(body: unknown): unknown {
  const school = isObj(body) ? SchoolPosition.safeParse(body.school) : undefined
  if (!isObj(body) || !school?.success) return body
  return {
    ...body,
    generation: { ...defaultGeneration(school.data), ...(isObj(body.generation) ? body.generation : {}) },
  }
}

export const learnerRoutes: RouteModule = (app, { db }) => {
  /** Picker list: open to everyone on the device. */
  app.get('/learners', async () => {
    const rows = await db.select().from(learners).orderBy(learners.createdAt)
    return rows.map((l) => ({
      id: l.id,
      displayName: l.profile.displayName,
      school: l.profile.school,
      ageBand: ageBand(l.profile.school),
    }))
  })

  /** Full profile for adults, the learner view otherwise. */
  app.get('/learners/:id', async (req) => {
    const l = await requireLearner(db, Params.parse(req.params).id)
    // Adults get a superset of the learner view, so learner screens work on an unlocked device too.
    return req.gate?.adult ? { ...learnerView(l), ...full(l) } : learnerView(l)
  })

  app.post('/learners', async (req, reply) => {
    requireAdult(req)
    const [l] = await db
      .insert(learners)
      .values({ profile: validProfile(withAgeDefaults(req.body)) })
      .returning()
    return reply.status(201).send(full(l!))
  })

  /** Partial update; `support` and `generation` merge field by field. */
  app.patch('/learners/:id', async (req) => {
    requireAdult(req)
    const cur = await requireLearner(db, Params.parse(req.params).id)
    if (!isObj(req.body)) throw new HttpError(400, 'invalid_request', 'Ogiltig förfrågan.')
    const b = req.body
    const profile = validProfile({
      ...cur.profile,
      ...b,
      support: { ...cur.profile.support, ...(isObj(b.support) ? b.support : {}) },
      generation: { ...cur.profile.generation, ...(isObj(b.generation) ? b.generation : {}) },
    })
    const [l] = await db
      .update(learners)
      .set({ profile, updatedAt: new Date() })
      .where(eq(learners.id, cur.id))
      .returning()
    return full(l!)
  })

  app.delete('/learners/:id', async (req, reply) => {
    requireAdult(req)
    const cur = await requireLearner(db, Params.parse(req.params).id)
    await db.delete(learners).where(eq(learners.id, cur.id))
    return reply.status(204).send()
  })

  /**
   * Import the old web app's localStorage['jackapp:v1'] JSON. Idempotent per learner + payload.
   * Old settings (free play, sound, speech, motion) are only reported in `settings.changes`
   * unless the adult opts in with `?applySettings=true`.
   */
  app.post('/learners/:id/legacy-import', async (req, reply) => {
    requireAdult(req)
    const cur = await requireLearner(db, Params.parse(req.params).id)
    const { applySettings } = z.object({ applySettings: z.enum(['true', 'false']).optional() }).parse(req.query)
    const r = await importLegacy(db, cur.id, req.body)
    const changes = legacySettingChanges(cur.profile, LegacyAppState.parse(req.body).settings)
    const applied = applySettings === 'true' && changes.length > 0
    if (applied)
      await db
        .update(learners)
        .set({ profile: applySettingChanges(cur.profile, changes), updatedAt: new Date() })
        .where(eq(learners.id, cur.id))
    return reply.status(r.created ? 201 : 200).send({ ...r, settings: { applied, changes } })
  })
}
