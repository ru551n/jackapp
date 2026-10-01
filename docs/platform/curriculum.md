# Curriculum (Skolverket)

Official curriculum comes only from Skolverket. AI never writes curriculum rows or invents refs: generation gets candidates from `suggestRefs` and every ref it returns is checked with `isValidRef`. At request resolution, `isValidRefFor(db, ref, position)` additionally checks that the ref fits the learner: same stage, the subject applies to the year (and gymnasium reform), and the span covers the year.

## Source

| What          | Value                                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| API           | Skolverket Syllabus API, **v1** (stable). v2 is alpha and not used.                                                           |
| Base URL      | `https://api.skolverket.se/syllabus/v1`                                                                                       |
| Documentation | https://www.skolverket.se/om-skolverket/webbplatser-och-tjanster/oppna-data/api-for-laroplaner-kurs--och-amnesplaner-syllabus |
| OpenAPI       | `https://api.skolverket.se/syllabus/v3/api-docs` (swagger config lists the v1 and v2 groups)                                  |
| Licence       | CC0 1.0 (Skolverkets öppna data); attribution not required, but we keep it anyway                                             |
| API version   | `1.16.2-SNAPSHOT` (released 2026-05-08) at retrieval                                                                          |
| Retrieved     | 2026-10-01 → `server/curriculum/data/skolverket-2026-10-01.json.gz`                                                           |

Endpoints used:

- `GET /subjects?schooltype=GR&timespan=LATEST` and `GET /subjects?schooltype=GY&timespan=LATEST`: subject lists.
- `GET /subjects/{code}`: syfte, centralt innehåll, kunskapskrav/betygskriterier (and for gymnasium the courses or levels).
- `GET /curriculums/LGR22`: Lgr22 chapter 3 (förskoleklass).
- `GET /api-info`: API version.

## Coverage (snapshot 2026-10-01)

312 subjects, 15 284 items (10 152 central content, 2 897 knowledge requirements / betygskriterier, 2 235 purpose goals); 5.8 MB JSON, 0.8 MB gzipped.

- **Förskoleklass**: no subject syllabi exist. Lgr22 chapter 3 has its own syfte and centralt innehåll, imported as one pseudo-subject `LGR22-FK` (stage `forskoleklass`, year 0, span `F`), with the areas (Språk och kommunikation, Matematiska resonemang…) as item areas and the "förmåga att" list as goals.
- **Grundskola (Lgr22)**: all 27 subjects of schooltype GR, including svenska som andraspråk, moderna språk (språkval and skolans val, incl. kinesiska variants via `section`), modersmål, teckenspråk, samiska, dans, judiska studier. Spans as in the source (`1-3`, `4-6`, `7-9`, `4-9`). Kunskapskrav for year 1/3/6/9 map to spans `1-3`/`1-3`/`4-6`/`7-9`, with `gradeStep` E–A.
- **Gymnasieskola**: all non-vocational subjects (gymnasiegemensamma and other subjects; yrkesämnen are excluded) in **both** systems:
  - **GY25** (subjects with levels, `GRADE_SUBJECT_SYLLABUS`, for students starting from 1 July 2025): 201 subjects. Span = level code, e.g. `MATE1A00X`. Betygskriterier are subject-wide (no span).
  - **GY11** (courses, `SUBJECT_SYLLABUS`): 83 subjects, still valid (end date 2030-06-30) for students who started earlier. Span = course code, e.g. `MATMAT01a`.
  - `subjectsFor` picks the reform from the programme year and today's date (`gyReformFor`): in autumn 2026, years 1–2 follow GY25 and year 3 follows GY11.
  - `gyReformFor` edge cases: the school year is taken to start on **1 July** (UTC), so a year-1 student on 30 June 2025 is GY11 and on 1 July 2025 GY25. It assumes a normal three-year path: students who repeat a year, take a fourth year, study at a reduced pace or switch programmes may follow GY11 although the formula says GY25 (or the reverse); the adult can then pick the subject explicitly. From 1 July 2027 every year 1–3 student maps to GY25; GY11 rows stay stored (end date 2030-06-30) so old refs remain valid.

## Data model

Snapshot schema: `server/curriculum/snapshot.ts`. Tables (`server/db/schema/curriculum.ts`): `curriculum_versions` (version = retrieval date, source, retrievedAt, apiVersion, licence, sourceUrls, contentHash, active), `curriculum_subjects`, `curriculum_items`.

- The syfte is stored verbatim as plain text (no AI summary).
- **Item ids**: the API has no ids for content items, so ids are `<subject>:<span>:<cc|kr|goal>:<sha256(subject, span, kind, section, area, gradeStep, text)[0:12]>`. They stay stable across snapshots while the text is unchanged.
- `CurriculumRef.version` is the snapshot version; `span` is the year span or the gymnasium course/level code; `itemId` the item id.
- **Item kinds**: `central_content` (centralt innehåll), `goal` (the syfte's "förmåga att" list) and `knowledge_requirement`. The last name is historical: for Lgr22 these are the **betygskriterier / kriterier för bedömning av kunskaper** (Lgr22 replaced "kunskapskrav" with criteria in 2022), and for GY25 the subject-wide betygskriterier. Treat them as assessment criteria, not as content to teach.

## Updating

1. `npm run curriculum:fetch` writes `server/curriculum/data/skolverket-<today>.json.gz`; commit it (keep older files only if needed for refs).
2. At startup/migrate the orchestrator calls `syncBundledCurriculum(db)`: it loads the newest bundled snapshot unless an equal or newer version is already active. `syncCurriculumSnapshot` is idempotent per version (same content hash: no-op; changed content: replaced) and marks the version active.
3. The `curriculum.sync` job (`curriculumJobHandlers`) fetches the live API and stores it as a new active version without a redeploy.
4. Old versions stay stored, so existing refs remain valid; `activateCurriculumVersion` switches back.

## API

Read-only, no adult gate:

- `GET /api/v1/curriculum/subjects?stage=&year=`
- `GET /api/v1/curriculum/subjects/:code?year=` (grundskola content limited to the span covering `year`)
- `GET /api/v1/curriculum/search?q=&stage=&year=&subject=&limit=`: BM25 over central content and goals with light Swedish normalization (lowercase, å/ä/ö kept, stopwords, suffix stripping).

### Search (`suggestRefs`)

- "åk 4", "årskurs 4" and "klass 4" are removed from the query and the number replaces the grundskola year.
- Stems match exactly, or by prefix in either direction when both are at least 5 letters (`fotosyntesen` ~ `fotosyntes`, `vikingatiden` ~ `vikingar`). Short stems (`tid`) match exactly only.
- A small curated synonym map (`SYNONYMS` in `service.ts`) adds the curriculum's own words: multiplikation/division/addition/subtraktion/gånger/plus/minus → räknesätt, klocka → tid, glosor → ordförråd, bråk → bråkform, vikingatiden → vikingar/800–1500 and a few more. Add entries when real queries miss; keep each one to a core concept.
- Tokenized documents are cached in memory per (version, subjects, year) and cleared when a snapshot changes, so repeated searches cost milliseconds instead of re-tokenizing thousands of items.

## Limitations

- HTML is parsed with a small tag scanner; structure beyond h3/h4/emphasized paragraphs/list items (e.g. tables) is flattened to text.
- Vocational gymnasium subjects, anpassad grundskola/gymnasieskola, sameskola-specific syllabi beyond samiska and komvux are not imported.
- Search is lexical: paraphrases without a shared stem or a curated synonym are not matched.

## 2028 reform: ten-year grundskola

Decided direction (Skolverket/government, check the final ordinance before acting): from **autumn 2028** grundskola becomes ten years, förskoleklass ends as a separate school form and becomes the first year of grundskola, and new syllabi apply. No contract change is made now; the plan:

1. **Positions.** `SchoolPosition` keeps `stage` + `year`. When the reform is in force, a new year numbering for grundskola (1–10, or 0–9 if the ordinance keeps "förskoleklass" as year 0 inside grundskola) is added alongside the old one, chosen by school start date like `gyReformFor` does for GY11/GY25 (a `grReformFor(year, asOf)`). Existing learners keep their stage/year; a one-off migration moves förskoleklass learners into grundskola year 1 at the next school-year start.
2. **Curriculum data.** New syllabi arrive from the same API as a new snapshot version. Subjects get a reform marker (as `reform` does for GY11/GY25) so `subjectsFor` returns old syllabi to learners still on the old plan during the transition. `LGR22-FK` stays stored for old refs but is no longer offered once förskoleklass is gone.
3. **Spans.** New spans (e.g. `1-4`, `5-7`, `8-10` or whatever the syllabi use) come straight from the source; `yearsOfSpan`/`spanCovers` already parse any `a-b` span. Year-bound mapping of criteria (today 1/3/6/9) must be revisited against the new syllabi.
4. **Refs.** Old snapshot versions stay stored, so artifacts and progress that cite Lgr22 refs remain valid; `isValidRefFor` naturally stops offering them to learners on the new plan.
5. **Timing.** Fetch the first published new-syllabus snapshot as soon as Skolverket releases it (expected well before autumn 2028), test it in a staging database, then ship the position and `subjectsFor` changes before the school year starts.
