# Web research, provenance and licensed assets

Code: `server/research/`. Tables: `research_briefs`, `research_sources` (`server/db/schema/research.ts`) and the shared `assets` table.

Both features are on by default and can be switched off globally:

| Env                       | Effect when `false`                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `FEATURE_WEB_RESEARCH`    | `researchBrief` returns `null`; `research.run` jobs fail with `feature_disabled`. Also off when `AI_RESEARCH_PROVIDER` or `AI_TEXT_PROVIDER` is unset. |
| `FEATURE_EXTERNAL_ASSETS` | `findLicensedImages` returns `[]` without any network access; `asset.fetch` jobs fail with `no_assets`.                                                |

Already stored assets keep working (and keep their attribution) when a flag is turned off.

## For other modules

```ts
import { researchBrief } from '../research/brief'
import { findLicensedImages } from '../research/assets'

// null when disabled → generate without web research.
const r = await researchBrief(db, ai, { topic, language: 'sv', school })
// r.brief = { summary, keyPoints: [{ text, sources: [1, 2] }] }  (sources = 1-based into r.sources)
// r.sources: SourceRef[] (kind 'web'); r.briefId for provenance.

const media: MediaRef[] = await findLicensedImages(db, { query: 'Saab 37 Viggen', count: 2, preferFactual: true })
```

Generation calls `researchBrief` for `useWebResearch` requests (generation.md) and enqueues `asset.fetch` for illustration slots that need real imagery (images.md).

Jobs: `research.run` `{ topic, language?, school? }` → `resultId` = brief id. `asset.fetch` `{ query, count?, preferFactual? }` → first asset id.

Routes:

- `GET /api/v1/assets/:id/attribution` (everyone): `{ attribution, attributionRequired, license, licenseUrl, creator, sourceUrl, provider, generated }`. Render `attribution` next to the image whenever `attributionRequired`.
- `GET /api/v1/research/provenance?briefIds=a,b&assetIds=c,d` (adult): briefs with their cited sources (url, title, publisher, retrievedAt, ≤300-char excerpt) and assets with full licence records. Up to 50 ids each.

## Web research pipeline

1. Search with the configured `AI_RESEARCH_PROVIDER` (8 results).
2. For each result, in order, until 5 sources: check robots.txt, fetch with the safe fetcher (HTML/text only), extract text. Sources that fail, are blocked or have under 200 characters of text are skipped.
3. The text model gets up to 6000 characters per numbered source and must fill a strict schema: a summary (≤1500 chars) and 1–10 key points (≤300 chars each), each citing source numbers.
4. Deterministic checks: citations to non-existent sources are removed; key points that copy a source verbatim (a 120-character window found in a source) are dropped; a copying summary rejects the whole brief (`ai_invalid_output`).
5. Stored: the brief, and per source url, title, publisher, retrievedAt and an excerpt capped at 300 characters (the search snippet). Full page text is never stored or returned.

### Robots.txt

Fetched once per origin per research run with the User-Agent `JackAppBot/1.0 (...)` and token `jackappbot`. Supported: `User-agent` groups (our token, otherwise `*`), `Allow`, `Disallow`, `*` and `$` wildcards; longest match wins, `Allow` wins ties. A 4xx response means no restrictions; 5xx or an unreachable host means "disallow everything" (RFC 9309). `Crawl-delay` and `Sitemap` are ignored: we fetch at most a handful of pages per run. Robots.txt applies to research page fetches; API calls to Commons/Openverse and the image downloads they point to are not crawling.

## Safe fetcher

`safeFetch` (`server/research/fetch.ts`) is used for every outbound request to an untrusted URL.

- **Schemes:** http and https only; URLs with credentials are rejected.
- **SSRF:** the host is resolved once (all addresses). If any address is loopback, private (RFC 1918), CGNAT, link-local (incl. `169.254.169.254` metadata), multicast, reserved, documentation, IPv6 loopback/ULA/link-local/site-local, NAT64, 6to4 or Teredo, the request is refused. IPv4-mapped IPv6 is checked against the IPv4 rules. The socket then connects to exactly the checked address (a custom `lookup` hands it over), so a DNS-rebinding answer cannot swap the target between check and connect. Literal IP hosts, including decimal and hex forms, are normalized by the URL parser and checked the same way.
- **Redirects:** at most 5; each hop is re-validated (scheme, DNS, address policy).
- **Limits:** 10 s total timeout; body cap 2 MB for pages (5 MB for images); the cap counts decoded bytes, so gzip/brotli bombs stop at the cap.
- **Content type:** per-call allowlist (pages: `text/html`, `application/xhtml+xml`, `text/plain`; APIs: `application/json`; images: `image/jpeg`, `image/png`, `image/webp`). Image bytes are additionally sniffed by magic number before storage. SVG is never fetched (it can carry script and is served from our origin).
- **Identity:** polite User-Agent naming the app and that it respects robots.txt.

The worker container should still have no route to internal admin networks; the fetcher is defence in depth, not the only layer.

## Licence policy

Classification is deterministic (`classifyLicense` in `server/research/licensing.ts`); a model never decides it.

| Licence                                                     | Stored id      | Auto-usable | Attribution                 |
| ----------------------------------------------------------- | -------------- | ----------- | --------------------------- |
| CC0                                                         | `CC0-1.0`      | yes         | given anyway (courtesy)     |
| Public domain, PD-\* (PD-USGov, PD-old, …), Openverse `pdm` | `PD`           | yes         | given anyway (courtesy)     |
| CC BY 1.0–4.0 (incl. ported, e.g. 3.0-de)                   | `CC-BY-x.y`    | yes         | required (TASL)             |
| CC BY-SA 1.0–4.0                                            | `CC-BY-SA-x.y` | yes         | required + share-alike note |
| CC BY-NC, BY-NC-SA, BY-NC-ND                                | `CC-BY-NC-…`   | **no**      | –                           |
| CC BY-ND                                                    | `CC-BY-ND-x.y` | **no**      | –                           |
| CC BY without a known version                               | `CC-BY`        | **no**      | –                           |
| GFDL only, "Attribution" template, sampling+, anything else | `unknown`      | **no**      | –                           |
| Missing licence metadata                                    | `unknown`      | **no**      | –                           |

Further rejections: Commons files with `Restrictions` (trademark, personality rights, …), candidates without a source page to link, Openverse results flagged `mature`.

Why NC and ND are denied: **ND** forbids adaptations, and we place images in exercise layouts, crop and scale them, which can count as an adaptation. **NC**'s "non-commercial" is unclear for a self-hosted platform and for content that may later be shared, and the licensor's own reading is what counts; a household app shouldn't carry that ambiguity by default. **Unknown** is never used automatically: without a licence we have no permission at all.

### Attribution

Built per Creative Commons' TASL guidance (Title, Author, Source, Licence), in Swedish, max 500 characters:

```
”Saab JAS 39 Gripen”, av Example Photographer, licens: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0), källa: Wikimedia Commons, https://commons.wikimedia.org/wiki/File:… . Får delas vidare under samma licens.
```

The author is taken from Commons `Artist` (HTML stripped) or Openverse `creator`; if missing, "okänd upphovsperson". The full licence record (`AssetLicense`) is stored with the asset and travels with every `MediaRef`. Images are stored unmodified (Commons serves a ≤1024 px thumbnail, which is the file owner's own rendition), so no "modified" notice is needed; add one if a later step crops or edits images.

## Sources

- Wikimedia Commons: MediaWiki API `generator=search`, `gsrnamespace=6` (File), `prop=imageinfo`, `iiprop=url|extmetadata|mime`, `iiurlwidth=1024`. `preferFactual` adds `filetype:bitmap` (photos over diagrams/SVG).
- Openverse: `GET https://api.openverse.org/v1/images/?q=…&license=cc0,pdm,by,by-sa&mature=false`, plus `category=photograph` when `preferFactual`. The API's own licence filter is not trusted; every result is classified again.

Results are interleaved (Commons first). Neither needs a key; anonymous Openverse use is rate-limited.

## Limitations

- HTML extraction is regex-based: fine for article pages, poor for script-rendered sites (those are skipped as too short).
- The copy guard catches verbatim runs only, not close paraphrase.
- Commons search can return off-topic or unsuitable images; there is no image-content check. Adults see every asset and its licence in the provenance view.
- No image normalization (no `sharp`): images are stored as served, within the 5 MB cap.
- Robots.txt is cached per run, not across runs.
