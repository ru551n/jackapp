import { z } from 'zod'
import { SchoolPosition, SchoolStage, SubjectCode } from '../../shared/contracts'
import type { RouteModule } from '../app/context'
import { HttpError } from '../gate/guards'
import { activeVersion, subject, subjectsFor, suggestRefs } from './service'

// Read-only official curriculum; open to everyone (no adult gate).

const Year = z.coerce.number().int().min(0).max(9)
const PositionQuery = z.object({ stage: SchoolStage, year: Year }).pipe(SchoolPosition)

export const curriculumRoutes: RouteModule = (app, { db }) => {
  app.get('/curriculum/subjects', async (req) => {
    const position = PositionQuery.parse(req.query)
    return { version: await activeVersion(db), subjects: await subjectsFor(db, position) }
  })

  app.get('/curriculum/subjects/:code', async (req) => {
    const { code } = z.object({ code: SubjectCode }).parse(req.params)
    const { year } = z.object({ year: Year.optional() }).parse(req.query)
    const s = await subject(db, code, year)
    if (!s) throw new HttpError(404, 'not_found', 'Ämnet finns inte i läroplanen.')
    return s
  })

  app.get('/curriculum/search', async (req) => {
    const q = z
      .object({
        q: z.string().trim().min(2).max(500),
        stage: SchoolStage,
        year: Year,
        subject: SubjectCode.optional(),
        limit: z.coerce.number().int().min(1).max(50).default(10),
      })
      .parse(req.query)
    const position = SchoolPosition.parse({ stage: q.stage, year: q.year })
    return { results: await suggestRefs(db, { position, subjectCode: q.subject, text: q.q, limit: q.limit }) }
  })
}
