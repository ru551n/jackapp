import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { artifacts, artifactVersions, assets } from '../db/schema'
import { createTestApp, seedLearner } from '../test/helpers'
import { gcAssets, storeAsset } from './store'

let close: (() => Promise<void>) | undefined
afterEach(async () => close?.())

const license = { kind: 'generated' } as never
const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

describe('asset store', () => {
  it('refuses SVG and serves assets with a sandboxing CSP', async () => {
    const t = await createTestApp()
    close = t.close
    const dir = mkdtempSync(join(tmpdir(), 'jackapp-assets-'))
    const svg = {
      data: Buffer.from('<svg onload="alert(1)"/>'),
      mimeType: 'image/svg+xml',
      alt: 'x',
      generated: true,
      license,
    }
    await expect(storeAsset(t.db, dir, svg)).rejects.toThrow(/unsupported/)
    const row = await storeAsset(t.db, dir, { ...svg, data: png, mimeType: 'image/png' })
    t.app.ctx.env.DATA_DIR = dir
    const r = await t.app.inject(`/api/v1/assets/${row.id}`)
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-security-policy']).toBe("default-src 'none'; sandbox")
  })

  it('garbage-collects assets no artifact version references, after a grace period', async () => {
    const t = await createTestApp()
    close = t.close
    const dir = mkdtempSync(join(tmpdir(), 'jackapp-assets-'))
    const mk = (b: number) =>
      storeAsset(t.db, dir, {
        data: Buffer.from([...png, b]),
        mimeType: 'image/png',
        alt: 'a',
        generated: true,
        license,
      })
    const [used, unused, fresh] = [await mk(1), await mk(2), await mk(3)]
    const old = new Date(Date.now() - 8 * 86_400_000)
    for (const a of [used, unused]) await t.db.update(assets).set({ createdAt: old }).where(eq(assets.id, a.id))
    const l = await seedLearner(t.db)
    const [art] = await t.db
      .insert(artifacts)
      .values({
        learnerId: l.id,
        type: 'lesson',
        title: 'x',
        school: { stage: 'grundskola', year: 1 },
        sourceMode: 'curriculum',
        feedback: 'immediate',
        approval: 'approved',
        createdBy: 'adult',
        request: {} as never,
      } as never)
      .returning()
    await t.db.insert(artifactVersions).values({
      artifactId: art!.id,
      version: 1,
      content: { sections: [{ items: [{ media: [{ assetId: used.id }] }] }] } as never,
      validation: {} as never,
      origin: 'generate',
    })
    expect(await gcAssets(t.db, dir)).toBe(1)
    const left = (await t.db.select().from(assets)).map((a) => a.id).sort()
    expect(left).toEqual([used.id, fresh.id].sort())
    expect(existsSync(join(dir, 'assets', unused.path))).toBe(false)
    expect(existsSync(join(dir, 'assets', used.path))).toBe(true)
  })
})
