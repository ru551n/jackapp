import { AssetLicense } from '../../shared/contracts'
import { clip } from './brief'
import { stripHtml } from './text'

// Deterministic licence policy for external media. Policy table and reasoning:
// docs/platform/research-and-licensing.md#licence-policy

export interface LicenseVerdict {
  /** SPDX-like id, e.g. "CC-BY-SA-4.0", "CC0-1.0", "PD", or "unknown". */
  license: string
  /** Human label for attribution, e.g. "CC BY-SA 4.0". */
  label: string
  autoUsable: boolean
  attributionRequired: boolean
  shareAlike: boolean
  /** Why it was rejected (logs/admin), when not usable. */
  reason?: string
}

const deny = (license: string, label: string, reason: string): LicenseVerdict => ({
  license,
  label,
  autoUsable: false,
  attributionRequired: true,
  shareAlike: false,
  reason,
})

/**
 * Classify a licence string from Commons (`License`/`LicenseShortName`, e.g. "cc-by-sa-4.0",
 * "CC BY-SA 4.0", "pd", "Public domain", "PD-USGov-NASA") or Openverse (`license` + version,
 * e.g. "by-sa" + "4.0", "cc0", "pdm").
 */
export function classifyLicense(raw: string | undefined, version?: string): LicenseVerdict {
  const s = (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
  if (!s) return deny('unknown', 'okänd licens', 'missing licence')
  if (/^(cc0|cc-zero)(-1\.0)?$/.test(s)) return ok('CC0-1.0', 'CC0 1.0', false, false)
  if (/^(pd|pdm|public-domain|pd-.+)$/.test(s)) return ok('PD', 'Public domain', false, false)
  // "by-sa" (Openverse) or "cc-by-sa-4.0" / "cc-by-sa-3.0-de" (Commons)
  const m = /^(?:cc-)?(by(?:-(?:sa|nc|nd|nc-sa|nc-nd))?)(?:-(\d\.\d)(?:-[a-z]{2,})?)?$/.exec(s)
  if (m) {
    const kind = m[1]!.toUpperCase()
    const ver = m[2] ?? (version && /^\d\.\d$/.test(version) ? version : undefined)
    const id = `CC-${kind}${ver ? `-${ver}` : ''}`
    const label = `CC ${kind}${ver ? ` ${ver}` : ''}`
    if (/NC|ND/.test(kind)) return deny(id, label, 'non-commercial or no-derivatives licence')
    if (!ver) return deny(id, label, 'licence version unknown')
    return ok(id, label, true, kind === 'BY-SA')
  }
  return deny('unknown', raw!.slice(0, 60), 'licence not on allowlist')
}

function ok(license: string, label: string, attributionRequired: boolean, shareAlike: boolean): LicenseVerdict {
  return { license, label, autoUsable: true, attributionRequired, shareAlike }
}

/** CC TASL attribution in Swedish: Title, Author, Source, Licence (+ share-alike note). ≤500 chars. */
export function buildAttribution(a: {
  title: string
  creator?: string
  sourceUrl: string
  provider: string
  label: string
  licenseUrl?: string
  shareAlike: boolean
}): string {
  const lic = a.licenseUrl ? `${a.label} (${a.licenseUrl})` : a.label
  const parts = [
    `”${clip(a.title, 120)}”`,
    a.creator ? `av ${clip(a.creator, 100)}` : 'okänd upphovsperson',
    `licens: ${lic}`,
    `källa: ${a.provider}, ${a.sourceUrl}`,
  ]
  const text = `${parts.join(', ')}.${a.shareAlike ? ' Får delas vidare under samma licens.' : ''}`
  return clip(text, 500)
}

/** Candidate image from a provider, already licence-checked. */
export interface Candidate {
  title: string
  alt: string
  /** Image to download (Commons: a ≤1024 px thumbnail). */
  downloadUrl: string
  license: AssetLicense
  verdict: LicenseVerdict
}

const httpsUrl = (u: unknown): string | undefined => {
  if (typeof u !== 'string' || !u) return undefined
  const v = u.startsWith('//') ? `https:${u}` : u
  try {
    const p = new URL(v)
    return p.protocol === 'https:' || p.protocol === 'http:' ? p.href : undefined
  } catch {
    return undefined
  }
}

function finish(
  c: Omit<Candidate, 'license'> & {
    creator?: string
    sourceUrl?: string
    licenseUrl?: string
    provider: string
    retrievedAt: string
  },
): Candidate | undefined {
  const v = { ...c.verdict }
  if (v.autoUsable && !c.sourceUrl) Object.assign(v, { autoUsable: false, reason: 'no source page to attribute' })
  const license = AssetLicense.safeParse({
    license: v.license,
    licenseUrl: c.licenseUrl,
    creator: c.creator ? clip(c.creator, 200) : undefined,
    attribution: c.sourceUrl
      ? buildAttribution({
          title: c.title,
          creator: c.creator,
          sourceUrl: c.sourceUrl,
          provider: c.provider,
          label: v.label,
          licenseUrl: c.licenseUrl,
          shareAlike: v.shareAlike,
        })
      : undefined,
    sourceUrl: c.sourceUrl,
    assetUrl: c.downloadUrl,
    provider: c.provider,
    retrievedAt: c.retrievedAt,
    autoUsable: v.autoUsable,
  })
  if (!license.success) return undefined
  return { title: c.title, alt: c.alt, downloadUrl: c.downloadUrl, license: license.data, verdict: v }
}

const meta = (em: any, k: string): string | undefined => {
  const v = em?.[k]?.value
  return typeof v === 'string' && v.trim() ? v : undefined
}

/** Parse a MediaWiki `generator=search&prop=imageinfo&iiprop=url|extmetadata|mime` response, in search order. */
export function parseCommons(json: any, retrievedAt: string): Candidate[] {
  const pages: any[] = Object.values(json?.query?.pages ?? {})
  pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  const out: Candidate[] = []
  for (const p of pages) {
    const ii = p?.imageinfo?.[0]
    const em = ii?.extmetadata
    const downloadUrl = httpsUrl(ii?.thumburl ?? ii?.url)
    if (!downloadUrl || typeof p.title !== 'string') continue
    let verdict = classifyLicense(meta(em, 'License') ?? meta(em, 'LicenseShortName'))
    if (!verdict.autoUsable && meta(em, 'License') && meta(em, 'LicenseShortName'))
      verdict = classifyLicense(meta(em, 'LicenseShortName'))
    // Trademark/personality-rights and similar restrictions need a human decision.
    if (verdict.autoUsable && meta(em, 'Restrictions'))
      verdict = { ...verdict, autoUsable: false, reason: `restrictions: ${meta(em, 'Restrictions')}` }
    const title = p.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '')
    const name = meta(em, 'ObjectName')
    const c = finish({
      title: name ? stripHtml(name) || title : title,
      alt: clip(stripHtml(meta(em, 'ImageDescription') ?? '') || title, 300),
      downloadUrl,
      verdict,
      creator: stripHtml(meta(em, 'Artist') ?? meta(em, 'Credit') ?? '') || undefined,
      sourceUrl: httpsUrl(ii.descriptionurl),
      licenseUrl: httpsUrl(meta(em, 'LicenseUrl')),
      provider: 'Wikimedia Commons',
      retrievedAt,
    })
    if (c) out.push(c)
  }
  return out
}

/** Parse an Openverse `/v1/images/` response. */
export function parseOpenverse(json: any, retrievedAt: string): Candidate[] {
  const out: Candidate[] = []
  for (const r of json?.results ?? []) {
    const downloadUrl = httpsUrl(r?.url)
    if (!downloadUrl || r.mature) continue
    const title = stripHtml(String(r.title ?? '')) || 'Bild'
    const via = typeof r.source === 'string' && r.source ? `Openverse (${r.source})` : 'Openverse'
    const c = finish({
      title,
      alt: clip(title, 300),
      downloadUrl,
      verdict: classifyLicense(r.license, r.license_version),
      creator: stripHtml(String(r.creator ?? '')) || undefined,
      sourceUrl: httpsUrl(r.foreign_landing_url),
      licenseUrl: httpsUrl(r.license_url),
      provider: clip(via, 100),
      retrievedAt,
    })
    if (c) out.push(c)
  }
  return out
}
