import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { eq } from 'drizzle-orm'
import type { AssetLicense, MediaRef } from '../../shared/contracts'
import type { Db } from '../db/client'
import { assets } from '../db/schema'

// Asset storage shared by research (licensed images) and image generation. Content-addressed
// files under <dataDir>/assets; duplicates (same bytes) reuse the existing row.

export interface StoreAssetInput {
  data: Buffer
  mimeType: string
  alt: string
  generated: boolean
  license: AssetLicense
}

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

export async function storeAsset(db: Db, dataDir: string, input: StoreAssetInput) {
  const ext = EXT[input.mimeType]
  if (!ext) throw new Error(`unsupported asset type ${input.mimeType}`)
  const sha256 = createHash('sha256').update(input.data).digest('hex')
  const [existing] = await db.select().from(assets).where(eq(assets.sha256, sha256))
  if (existing) return existing
  const path = `${sha256.slice(0, 2)}/${sha256}.${ext}`
  const file = join(dataDir, 'assets', path)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, input.data)
  const [row] = await db
    .insert(assets)
    .values({
      kind: 'image',
      mimeType: input.mimeType,
      path,
      sha256,
      bytes: input.data.length,
      alt: input.alt,
      generated: input.generated,
      license: input.license,
    })
    .returning()
  return row!
}

export async function readAsset(db: Db, dataDir: string, id: string) {
  const [row] = await db.select().from(assets).where(eq(assets.id, id))
  if (!row) return undefined
  return { row, data: await readFile(join(dataDir, 'assets', row.path)) }
}

export const toMediaRef = (row: typeof assets.$inferSelect): MediaRef => ({
  assetId: row.id,
  kind: 'image',
  alt: row.alt,
  generated: row.generated,
  license: row.license,
})
