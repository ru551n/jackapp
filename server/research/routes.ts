import { inArray } from 'drizzle-orm'
import { z } from 'zod'
import type { RouteModule } from '../app/context'
import { assets, researchBriefs, researchSources } from '../db/schema'
import { HttpError, requireAdult } from '../gate/guards'

const NO_ATTRIBUTION = new Set(['CC0-1.0', 'PD', 'project-owned', 'ai-generated'])
const Ids = z
  .string()
  .optional()
  .transform((s) => (s ? s.split(',').map((x) => x.trim()) : []))
  .pipe(z.array(z.string().uuid()).max(50))

export const researchRoutes: RouteModule = (app, { db }) => {
  /** Attribution for rendering next to an asset (open to all: learner screens show it). */
  app.get('/assets/:id/attribution', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const [row] = await db
      .select()
      .from(assets)
      .where(inArray(assets.id, [id]))
    if (!row) throw new HttpError(404, 'not_found', 'Hittades inte.')
    const l = row.license
    return {
      assetId: row.id,
      generated: row.generated,
      attributionRequired: !NO_ATTRIBUTION.has(l.license),
      attribution: l.attribution,
      license: l.license,
      licenseUrl: l.licenseUrl,
      creator: l.creator,
      sourceUrl: l.sourceUrl,
      provider: l.provider,
    }
  })

  /** Adult: provenance of the research briefs and assets an artifact used (ids from the artifact). */
  app.get('/research/provenance', async (req) => {
    requireAdult(req)
    const q = z.object({ briefIds: Ids, assetIds: Ids }).parse(req.query)
    const briefs = q.briefIds.length
      ? await db.select().from(researchBriefs).where(inArray(researchBriefs.id, q.briefIds))
      : []
    const sources = briefs.length
      ? await db
          .select()
          .from(researchSources)
          .where(
            inArray(
              researchSources.briefId,
              briefs.map((b) => b.id),
            ),
          )
      : []
    const media = q.assetIds.length ? await db.select().from(assets).where(inArray(assets.id, q.assetIds)) : []
    return {
      briefs: briefs.map((b) => ({
        id: b.id,
        topic: b.topic,
        language: b.language,
        school: b.school,
        model: b.model,
        createdAt: b.createdAt.toISOString(),
        brief: b.brief,
        sources: sources
          .filter((s) => s.briefId === b.id)
          .sort((x, y) => x.index - y.index)
          .map((s) => ({
            index: s.index,
            kind: 'web' as const,
            url: s.url,
            title: s.title,
            publisher: s.publisher ?? undefined,
            retrievedAt: s.retrievedAt.toISOString(),
            excerpt: s.excerpt ?? undefined,
          })),
      })),
      assets: media.map((a) => ({
        id: a.id,
        alt: a.alt,
        generated: a.generated,
        mimeType: a.mimeType,
        createdAt: a.createdAt.toISOString(),
        license: a.license,
      })),
    }
  })
}
