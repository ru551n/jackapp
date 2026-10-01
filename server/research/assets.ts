import type { MediaRef } from '../../shared/contracts'
import { toMediaRef, storeAsset } from '../assets/store'
import { parseEnv } from '../config/env'
import { FeaturesEnv } from '../config/features'
import type { Db } from '../db/client'
import { safeFetch, type Fetcher, type SafeFetchOptions } from './fetch'
import { parseCommons, parseOpenverse, type Candidate } from './licensing'

// Licensed images from Wikimedia Commons and Openverse (both keyless). Only candidates the
// licence classifier marks autoUsable are downloaded and stored.

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
const OPENVERSE_API = 'https://api.openverse.org/v1/images/'
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] // no SVG: it can carry script
const IMAGE_MAX = 5 * 1024 * 1024

export interface FindImagesInput {
  query: string
  count: number
  /** Prefer real photographs (bitmap/photo filters) for factual topics. */
  preferFactual?: boolean
}

export interface AssetOptions {
  env?: NodeJS.ProcessEnv
  /** Default: env DATA_DIR or /data (as CoreEnv). */
  dataDir?: string
  fetcher?: Fetcher
  fetchOptions?: Omit<SafeFetchOptions, 'accept'>
  signal?: AbortSignal
}

export const externalAssetsEnabled = (env: NodeJS.ProcessEnv = process.env) =>
  parseEnv(FeaturesEnv, env).FEATURE_EXTERNAL_ASSETS

/** Sniff the real type from magic bytes; the header alone is not trusted for content we serve. */
export function sniffImage(b: Buffer): string | undefined {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png'
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP')
    return 'image/webp'
  return undefined
}

export async function searchCandidates(input: FindImagesInput, opts: AssetOptions = {}): Promise<Candidate[]> {
  const fetcher = opts.fetcher ?? safeFetch
  const base = { ...opts.fetchOptions, signal: opts.signal, accept: ['application/json'] }
  const limit = Math.min(Math.max(input.count * 4, 8), 30)
  const at = new Date().toISOString()
  const commons = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: input.preferFactual ? `${input.query} filetype:bitmap` : input.query,
    gsrnamespace: '6',
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|mime',
    iiurlwidth: '1024',
  })
  const openverse = new URLSearchParams({
    q: input.query,
    page_size: String(limit),
    license: 'cc0,pdm,by,by-sa',
    mature: 'false',
    ...(input.preferFactual ? { category: 'photograph' } : {}),
  })
  const json = async (url: string) => JSON.parse((await fetcher(url, base)).body.toString('utf8'))
  const [c, o] = await Promise.allSettled([
    json(`${COMMONS_API}?${commons}`).then((j) => parseCommons(j, at)),
    json(`${OPENVERSE_API}?${openverse}`).then((j) => parseOpenverse(j, at)),
  ])
  const a = c.status === 'fulfilled' ? c.value : []
  const b = o.status === 'fulfilled' ? o.value : []
  // Commons first (curated licence metadata), Openverse only fills up.
  return [...a, ...b]
}

/**
 * Licensed real images for factual visual topics (aircraft, vehicles, artifacts, geography,
 * science). Returns [] when FEATURE_EXTERNAL_ASSETS is off. Never returns unknown/NC/ND media.
 */
export async function findLicensedImages(db: Db, input: FindImagesInput, opts: AssetOptions = {}): Promise<MediaRef[]> {
  const env = opts.env ?? process.env
  if (!externalAssetsEnabled(env)) return []
  const fetcher = opts.fetcher ?? safeFetch
  const dataDir = opts.dataDir ?? (env.DATA_DIR || '/data')
  const out: MediaRef[] = []
  const seen = new Set<string>()
  for (const c of await searchCandidates({ preferFactual: true, ...input }, opts)) {
    if (out.length >= input.count) break
    if (!c.license.autoUsable) continue
    let data: Buffer
    try {
      const r = await fetcher(c.downloadUrl, {
        ...opts.fetchOptions,
        signal: opts.signal,
        accept: IMAGE_TYPES,
        maxBytes: IMAGE_MAX,
      })
      data = r.body
    } catch {
      continue
    }
    const mimeType = sniffImage(data)
    if (!mimeType) continue
    const row = await storeAsset(db, dataDir, { data, mimeType, alt: c.alt, generated: false, license: c.license })
    if (seen.has(row.id)) continue
    seen.add(row.id)
    out.push(toMediaRef(row))
  }
  return out
}
