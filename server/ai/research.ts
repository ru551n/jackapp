import type { ResearchCapConfig } from './config'
import { httpJson, httpRaw, joinUrl } from './http'
import type { SearchResult, WebResearch } from './types'

// Web search adapters: SearXNG (self-hosted, no key), Brave, Tavily.

const stripTags = (s: unknown) => (typeof s === 'string' ? s.replace(/<[^>]*>/g, '') : '')

export function createResearch(c: ResearchCapConfig): WebResearch {
  return {
    async search({ query, maxResults, language, signal }) {
      const opts = { timeoutMs: c.timeoutMs, signal }
      let rows: SearchResult[]
      if (c.provider === 'searxng') {
        const q = new URLSearchParams({ q: query, format: 'json', language })
        const r = await httpJson(joinUrl(c.baseUrl, `/search?${q}`), opts)
        rows = (r?.results ?? []).map((x: any) => ({ title: x.title, url: x.url, snippet: stripTags(x.content) }))
      } else if (c.provider === 'brave') {
        const q = new URLSearchParams({ q: query, count: String(Math.min(maxResults, 20)), search_lang: language })
        const r = await httpJson(joinUrl(c.baseUrl, `/res/v1/web/search?${q}`), {
          ...opts,
          headers: { 'x-subscription-token': c.apiKey ?? '', accept: 'application/json' },
        })
        rows = (r?.web?.results ?? []).map((x: any) => ({
          title: stripTags(x.title),
          url: x.url,
          snippet: stripTags(x.description),
          publisher: x.profile?.name,
        }))
      } else if (c.provider === 'tavily') {
        const r = await httpJson(joinUrl(c.baseUrl, '/search'), {
          ...opts,
          headers: { authorization: `Bearer ${c.apiKey}` },
          body: { query, max_results: maxResults },
        })
        rows = (r?.results ?? []).map((x: any) => ({ title: x.title, url: x.url, snippet: x.content ?? '' }))
      } else {
        rows = [
          { title: `Mock: ${query}`, url: 'https://example.org/mock', snippet: 'Mockresultat.', publisher: 'Mock' },
        ]
      }
      return rows.filter((x) => typeof x.url === 'string' && typeof x.title === 'string').slice(0, maxResults)
    },
  }
}

/** SearXNG has /healthz; Brave/Tavily have no free probe (null = unknown). */
export const researchProbe = (c: ResearchCapConfig, timeoutMs: number) =>
  c.provider === 'searxng' ? httpRaw(joinUrl(c.baseUrl, '/healthz'), { timeoutMs }) : null
