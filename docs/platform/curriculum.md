# Curriculum (Skolverket)

Official curriculum comes only from Skolverket. AI never writes curriculum rows or invents refs: generation gets candidates from `suggestRefs` and every ref it returns is checked with `isValidRef`.

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

## Data model

Snapshot schema: `server/curriculum/snapshot.ts`. Tables (`server/db/schema/curriculum.ts`): `curriculum_versions` (version = retrieval date, source, retrievedAt, apiVersion, licence, sourceUrls, contentHash, active), `curriculum_subjects`, `curriculum_items`.

- The syfte is stored verbatim as plain text (no AI summary).
- **Item ids**: the API has no ids for content items, so ids are `<subject>:<span>:<cc|kr|goal>:<sha256(subject, span, kind, section, area, gradeStep, text)[0:12]>`. They stay stable across snapshots while the text is unchanged.
- `CurriculumRef.version` is the snapshot version; `span` is the year span or the gymnasium course/level code; `itemId` the item id.

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

## Limitations

- HTML is parsed with a small tag scanner; structure beyond h3/h4/emphasized paragraphs/list items (e.g. tables) is flattened to text.
- Vocational gymnasium subjects, anpassad grundskola/gymnasieskola, sameskola-specific syllabi beyond samiska and komvux are not imported.
- Search is lexical: synonyms or paraphrases without shared stems are not matched.
