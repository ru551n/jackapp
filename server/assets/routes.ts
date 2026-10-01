import { z } from 'zod'
import type { RouteModule } from '../app/context'
import { HttpError } from '../gate/guards'
import { readAsset } from './store'

/** GET /api/v1/assets/:id — the image bytes (immutable, cacheable). Licence data travels with MediaRef. */
export const assetRoutes: RouteModule = (app, ctx) => {
  app.get('/assets/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params)
    const found = await readAsset(ctx.db, ctx.env.DATA_DIR, id).catch(() => undefined)
    if (!found) throw new HttpError(404, 'not_found', 'Hittades inte.')
    return reply
      .header('content-type', found.row.mimeType)
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .send(found.data)
  })
}
