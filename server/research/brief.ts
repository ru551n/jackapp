import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { SchoolPosition, SourceRef } from '../../shared/contracts'
import { AiError, type AiServices } from '../ai'
import { parseEnv } from '../config/env'
import { FeaturesEnv } from '../config/features'
import type { Db } from '../db/client'
import { researchBriefs, researchSources } from '../db/schema'
import { safeFetch, robotsChecker, type Fetcher, type SafeFetchOptions } from './fetch'
import { htmlToText } from './text'

// Web research → a cited, model-written brief. Stores summaries, citations and ≤300-char
// excerpts only (docs/platform/research-and-licensing.md).

export const EXCERPT_MAX = 300
const MAX_SOURCES = 5
const SOURCE_TEXT_MAX = 6000

/** Strict schema the text model must fill. `sources` are 1-based indices into the numbered source list. */
export const ResearchBriefSchema = z
  .object({
    summary: z.string().min(1).max(1500),
    keyPoints: z
      .array(
        z
          .object({
            text: z.string().min(1).max(300),
            sources: z.array(z.number().int().min(1)).min(1).max(5),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict()
export type ResearchBrief = z.infer<typeof ResearchBriefSchema>

export interface ResearchInput {
  topic: string
  /** BCP 47, default "sv". */
  language?: string
  school?: SchoolPosition
}

export interface ResearchOptions {
  env?: NodeJS.ProcessEnv
  /** Outbound fetcher (tests inject one); default safeFetch. */
  fetcher?: Fetcher
  /** Extra fetch options (tests: resolver/address policy). */
  fetchOptions?: Omit<SafeFetchOptions, 'accept'>
  signal?: AbortSignal
}

export class ResearchError extends Error {
  readonly code = 'no_sources'
}

export const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`)

const WINDOW = 120
/** True when `out` contains a verbatim run of ≥ WINDOW+20 chars from any source text (copy guard). */
export function copiesSource(out: string, sourceTexts: string[]): boolean {
  const norm = (s: string) => s.replace(/\s+/g, ' ').toLowerCase()
  const o = norm(out)
  const texts = sourceTexts.map(norm)
  for (let i = 0; i + WINDOW <= o.length; i += 20) {
    const w = o.slice(i, i + WINDOW)
    if (texts.some((t) => t.includes(w))) return true
  }
  return false
}

export const researchEnabled = (ai: AiServices | undefined, env: NodeJS.ProcessEnv = process.env) =>
  parseEnv(FeaturesEnv, env).FEATURE_WEB_RESEARCH && !!ai?.research && !!ai?.text

interface Gathered {
  url: string
  title: string
  publisher?: string
  retrievedAt: string
  excerpt?: string
  text: string
}

/**
 * Search, fetch (safe, robots-respecting), summarize with citations and store. Returns null when
 * web research is disabled or not configured; throws ResearchError when nothing usable was found.
 */
export async function researchBrief(
  db: Db,
  ai: AiServices | undefined,
  input: ResearchInput,
  opts: ResearchOptions = {},
): Promise<BriefResult | null> {
  if (!researchEnabled(ai, opts.env)) return null
  const language = input.language ?? 'sv'
  const fetcher = opts.fetcher ?? safeFetch
  const base = { ...opts.fetchOptions, signal: opts.signal }
  const allowed = robotsChecker(fetcher, base)

  const results = await ai!.research!.search({ query: input.topic, maxResults: 8, language, signal: opts.signal })
  const gathered: Gathered[] = []
  for (const r of results) {
    if (gathered.length >= MAX_SOURCES) break
    if (gathered.some((g) => g.url === r.url)) continue
    let page: Awaited<ReturnType<Fetcher>>
    try {
      if (!(await allowed(r.url))) continue
      page = await fetcher(r.url, { ...base, accept: ['text/html', 'application/xhtml+xml', 'text/plain'] })
    } catch {
      continue // unreachable, blocked, too large, wrong type: skip the source
    }
    const doc =
      page.contentType === 'text/plain' ? { text: page.body.toString('utf8') } : htmlToText(page.body.toString('utf8'))
    const text = doc.text.slice(0, SOURCE_TEXT_MAX)
    if (text.length < 200) continue
    gathered.push({
      url: page.url,
      title: clip(doc.title || r.title || new URL(page.url).hostname, 300),
      publisher: clip(('siteName' in doc && doc.siteName) || r.publisher || new URL(page.url).hostname, 200),
      retrievedAt: new Date().toISOString(),
      excerpt: clip((r.snippet || text).replace(/\s+/g, ' ').trim(), EXCERPT_MAX) || undefined,
      text,
    })
  }
  if (!gathered.length) throw new ResearchError('no usable sources')

  const level = input.school ? `${input.school.stage}, år ${input.school.year}` : 'okänd årskurs'
  const sourceBlock = gathered.map((g, i) => `[${i + 1}] ${g.title} (${g.publisher})\n${g.text}`).join('\n\n---\n\n')
  const { output, model } = await ai!.text!.generate({
    schemaName: 'research_brief',
    schema: ResearchBriefSchema,
    temperature: 0.2,
    system:
      'You write research briefs for teachers making school exercises. Use ONLY the numbered sources. ' +
      'Write in your own words: never copy sentences, never quote more than a few words. ' +
      'Every key point cites the source numbers it relies on. Where sources disagree, say so. ' +
      `Write in language "${language}". The learner level is ${level}.`,
    messages: [{ role: 'user', content: `Topic: ${input.topic}\n\nSources:\n\n${sourceBlock}` }],
    signal: opts.signal,
  })

  // Deterministic post-checks: drop dangling citations; reject verbatim copying.
  const texts = gathered.map((g) => g.text)
  const keyPoints = output.keyPoints
    .map((p) => ({ ...p, sources: p.sources.filter((n) => n <= gathered.length) }))
    .filter((p) => p.sources.length && !copiesSource(p.text, texts))
  if (!keyPoints.length || copiesSource(output.summary, texts))
    throw new AiError('ai_invalid_output', { detail: 'research brief copies sources or has no valid citations' })
  const brief: ResearchBrief = { summary: output.summary, keyPoints }

  const briefId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(researchBriefs)
      .values({ topic: input.topic, language, school: input.school, brief, model })
      .returning({ id: researchBriefs.id })
    await tx.insert(researchSources).values(
      gathered.map((g, i) => ({
        briefId: row!.id,
        index: i + 1,
        url: g.url,
        title: g.title,
        publisher: g.publisher,
        retrievedAt: new Date(g.retrievedAt),
        excerpt: g.excerpt,
      })),
    )
    return row!.id
  })

  const sources: SourceRef[] = gathered.map((g) => ({
    kind: 'web',
    url: g.url,
    title: g.title,
    publisher: g.publisher,
    retrievedAt: g.retrievedAt,
  }))
  return { briefId, brief, sources }
}

export type BriefResult = { briefId: string; brief: ResearchBrief; sources: SourceRef[] }

/** A stored brief with its sources in citation order (transforms reuse it instead of searching again). */
export async function loadBrief(db: Db, briefId: string): Promise<BriefResult | undefined> {
  const [b] = await db.select().from(researchBriefs).where(eq(researchBriefs.id, briefId))
  if (!b) return undefined
  const rows = await db
    .select()
    .from(researchSources)
    .where(eq(researchSources.briefId, briefId))
    .orderBy(asc(researchSources.index))
  const sources: SourceRef[] = rows.map((r) => ({
    kind: 'web',
    url: r.url,
    title: r.title,
    publisher: r.publisher ?? undefined,
    retrievedAt: r.retrievedAt.toISOString(),
  }))
  return { briefId, brief: b.brief, sources }
}
