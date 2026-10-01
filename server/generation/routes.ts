import { z } from 'zod'
import {
  Artifact as ArtifactSchema,
  ApprovalState,
  ArtifactType,
  GenerationRequest,
  type Artifact,
} from '../../shared/contracts'
import type { RouteModule } from '../app/context'
import { HttpError, requireAdult, requireLearner } from '../gate/guards'
import { jobsServices } from '../jobs'
import { unsafeThemes } from '../learners/profile'
import { defaultMaterialLoader, revalidate } from './engine'
import { nextApproval, TransformKindSchema } from './jobs'
import type { ResolvedRequest } from './request'
import { addVersion, listArtifacts, listVersions, loadArtifact, setApproval } from './store'
import { forLearner, requestedIllustrations } from './view'

const LearnerParams = z.object({ id: z.string().uuid() })
const Params = z.object({ artifactId: z.string().uuid() })
const ItemParams = Params.extend({ itemId: z.string().max(60) })
const ListQuery = z.object({
  type: ArtifactType.optional(),
  approval: ApprovalState.optional(),
  subject: z.string().max(32).optional(),
})

export const EditBody = z.object({
  title: z.string().min(1).max(200).optional(),
  sections: z
    .array(
      z.object({
        index: z.number().int().min(0),
        title: z.string().max(200).optional(),
        body: z.string().max(12000).optional(),
      }),
    )
    .optional(),
  /** itemId → fields to replace (prompt, choices, answer, hints, ...). `id` and `kind` cannot change. */
  items: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  removeItems: z.array(z.string()).optional(),
})

const TransformBody = z.object({ kind: TransformKindSchema, theme: z.string().min(1).max(100).optional() })

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const notFound = () => new HttpError(404, 'not_found', 'Hittades inte.')

/** Apply an adult edit; throws ZodError (→ 400) when the result breaks the contract. */
export function applyEdit(a: Artifact, e: z.infer<typeof EditBody>): Artifact {
  const ids = new Set(a.sections.flatMap((s) => s.items.map((i) => i.id)))
  for (const id of [...Object.keys(e.items ?? {}), ...(e.removeItems ?? [])])
    if (!ids.has(id)) throw new HttpError(400, 'unknown_item', 'Uppgiften finns inte i materialet.')
  const remove = new Set(e.removeItems)
  return ArtifactSchema.parse({
    ...a,
    title: e.title ?? a.title,
    sections: a.sections.map((s, n) => {
      const se = e.sections?.find((x) => x.index === n)
      return {
        ...s,
        title: se?.title ?? s.title,
        body: se?.body ?? s.body,
        items: s.items
          .filter((i) => !remove.has(i.id))
          .map((i) => ({ ...i, ...e.items?.[i.id], id: i.id, kind: i.kind })),
      }
    }),
  })
}

export const generationRoutes: RouteModule = (app, ctx) => {
  const { db } = ctx
  const jobs = () => ctx.jobs ?? jobsServices(ctx)

  async function load(id: string) {
    const s = await loadArtifact(db, id)
    if (!s) throw notFound()
    return s
  }

  /** Request material. Adults always; learners only when their profile allows it. */
  app.post('/learners/:id/generate', async (req, reply) => {
    const { id } = LearnerParams.parse(req.params)
    const learner = await requireLearner(db, id)
    const adult = !!req.gate?.adult
    if (!adult && !learner.profile.generation.learnerRequestsAllowed)
      throw new HttpError(403, 'requests_not_allowed', 'Be en vuxen om att skapa nytt material.')
    if (!isObj(req.body)) throw new HttpError(400, 'invalid_request', 'Ogiltig förfrågan.')
    const body = req.body
    // Free-text-only requests may omit `type`; interpretation can then choose it.
    const request = GenerationRequest.parse({
      ...body,
      type: body.type ?? (body.instructions ? 'exercises' : undefined),
      learnerId: id,
    })
    if (request.sourceMode === 'strict' && !request.studySetId)
      throw new HttpError(400, 'study_set_required', 'Strikt källäge kräver uppladdat material.')
    if (request.theme && unsafeThemes([request.theme]).length)
      throw new HttpError(400, 'unsafe_theme', 'Temat passar inte i JackApp.')
    const explicit = Object.keys(body).filter((k) => k !== 'learnerId' && body[k] !== undefined)
    const job = await jobs().enqueue({
      type: 'artifact.generate',
      payload: { request, explicit, createdBy: adult ? 'adult' : 'learner' },
      learnerId: id,
    })
    return reply.status(202).send({ jobId: job.id })
  })

  /** Adults see everything; learners only approved material. */
  app.get('/learners/:id/artifacts', async (req) => {
    const { id } = LearnerParams.parse(req.params)
    await requireLearner(db, id)
    const q = ListQuery.parse(req.query)
    const approval = req.gate?.adult ? q.approval : 'approved'
    if (!req.gate?.adult && q.approval && q.approval !== 'approved') return []
    return listArtifacts(db, id, { type: q.type, approval, subjectCode: q.subject })
  })

  app.get('/artifacts/:artifactId', async (req) => {
    const s = await load(Params.parse(req.params).artifactId)
    if (req.gate?.adult) {
      // For GET /research/provenance?briefIds=… (asset ids are on the items' media).
      const briefId = (s.row.request as ResolvedRequest).researchBriefId
      return {
        artifact: s.artifact,
        requestedIllustrations: requestedIllustrations(s),
        researchBriefIds: briefId ? [briefId] : [],
      }
    }
    if (s.artifact.approval !== 'approved') throw notFound()
    if (s.artifact.feedback === 'end') return { artifact: forLearner(s.artifact) }
    const { validation: _v, ...artifact } = s.artifact
    return { artifact }
  })

  app.get('/artifacts/:artifactId/versions', async (req) => {
    requireAdult(req)
    const { artifactId } = Params.parse(req.params)
    await load(artifactId)
    return listVersions(db, artifactId)
  })

  app.post('/artifacts/:artifactId/approve', async (req) => {
    requireAdult(req)
    const s = await load(Params.parse(req.params).artifactId)
    if (!s.artifact.validation.ok)
      throw new HttpError(409, 'validation_failed', 'Materialet har fel som behöver rättas innan det kan godkännas.')
    await setApproval(db, s.artifact.id, 'approved')
    return { ...s.artifact, approval: 'approved' }
  })

  app.post('/artifacts/:artifactId/reject', async (req) => {
    requireAdult(req)
    const s = await load(Params.parse(req.params).artifactId)
    await setApproval(db, s.artifact.id, 'rejected')
    return { ...s.artifact, approval: 'rejected' }
  })

  /** Edit → new version. Invalid edits are only stored on drafts (422 otherwise). */
  app.patch('/artifacts/:artifactId', async (req, reply) => {
    requireAdult(req)
    const s = await load(Params.parse(req.params).artifactId)
    const edit = EditBody.parse(req.body)
    const edited = applyEdit(s.artifact, edit)
    const learner = await requireLearner(db, s.row.learnerId)
    const request = s.row.request as ResolvedRequest
    const material = request.studySetId ? await defaultMaterialLoader(db, request.studySetId) : undefined
    const validation = await revalidate({}, edited, { request, material })
    if (!validation.ok && s.artifact.approval !== 'draft')
      return reply.status(422).send({
        error: { code: 'validation_failed', message: 'Ändringen klarade inte kontrollen och sparades inte.' },
        validation,
      })
    const approval = nextApproval(s.artifact.approval, validation.ok, learner.profile.generation.approval)
    const removed = new Set(edit.removeItems)
    const a = await addVersion(
      db,
      { ...edited, validation, approval },
      { origin: 'edit', illustrations: s.illustrations.filter((i) => !removed.has(i.itemId)) },
    )
    return a
  })

  app.post('/artifacts/:artifactId/items/:itemId/regenerate', async (req, reply) => {
    requireAdult(req)
    const { artifactId, itemId } = ItemParams.parse(req.params)
    const s = await load(artifactId)
    if (!s.artifact.sections.some((sec) => sec.items.some((i) => i.id === itemId))) throw notFound()
    const job = await jobs().enqueue({
      type: 'artifact.regenerateItem',
      payload: { artifactId, itemId },
      learnerId: s.row.learnerId,
      dedupeKey: `regen:${artifactId}:${itemId}`,
    })
    return reply.status(202).send({ jobId: job.id })
  })

  /** Rework stored material (reuses processed study material; no vision). */
  app.post('/artifacts/:artifactId/transform', async (req, reply) => {
    requireAdult(req)
    const { artifactId } = Params.parse(req.params)
    const body = TransformBody.parse(req.body)
    if (body.kind === 'changeTheme' && !body.theme) throw new HttpError(400, 'theme_required', 'Ange ett nytt tema.')
    if (body.theme && unsafeThemes([body.theme]).length)
      throw new HttpError(400, 'unsafe_theme', 'Temat passar inte i JackApp.')
    const s = await load(artifactId)
    const job = await jobs().enqueue({
      type: 'artifact.generate',
      payload: { transform: { artifactId, ...body }, createdBy: 'adult' },
      learnerId: s.row.learnerId,
    })
    return reply.status(202).send({ jobId: job.id })
  })
}
