# Generation engine (`server/generation`)

This module generates every kind of learning material: practice tests, exercises, lessons, worksheets, flashcards, reading comprehension, explanations, summaries, stories, writing prompts and projects. The AI produces structured data, which is stored as `Artifact` rows (`shared/contracts/content.ts`). Raw model text is never stored as the only copy.

| File               | Role                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------- |
| `routes.ts`        | HTTP API (below)                                                                        |
| `request.ts`       | Request interpretation and resolution of profile defaults                               |
| `prompts/index.ts` | Versioned prompt building blocks (`PROMPT_VERSION`)                                     |
| `items.ts`         | Model-facing item schema (smaller than the contract), and conversion to contract `Item` |
| `engine.ts`        | Blueprint, chunked generation, checks, one targeted repair                              |
| `jobs.ts`          | `artifact.generate` (new material and transforms) and `artifact.regenerateItem`         |
| `store.ts`         | `artifacts` and `artifact_versions` (`server/db/schema/generation.ts`)                  |
| `view.ts`          | `forLearner` and `requestedIllustrations`                                               |

## Request flow

```
POST /learners/:id/generate ──► validate + permission ──► enqueue artifact.generate ──► { jobId }
worker: [interpret instructions] → resolve defaults → load processed material → generate → check
        → [repair failing items once] → store artifact v1 → approved / pendingApproval / draft
```

1. **Permission.** Adults may always request material. A learner (no adult gate) may request material only when the profile has `generation.learnerRequestsAllowed`; otherwise the response is `403 requests_not_allowed`. Strict mode without a `studySetId` returns `400`, and so does an unsafe theme.
   - **Learner requests are field-restricted:** `useWebResearch`, `includeImages`, `school`, `support`, `curriculumRefs` and `skills` are dropped (they stay adult settings). The question count is capped at 20 (`LEARNER_MAX_QUESTIONS`, also after interpretation in the job), and a learner gets at most 20 requests per 24 h (`429 daily_limit`). Learner-made material **always waits for adult approval**, whatever the policy.
2. **Interpretation.** When `instructions` is set, for example "Skapa 10 matteuppgifter för årskurs 4 om multiplikation. Använd tåg som tema, lite text och mycket visuellt stöd.", one cheap structured call (`request_fields`, temperature 0) fills the request fields. The schema is loose on purpose. The server then clamps the values to the contract's limits (count 1–60, difficulty 1–5, duration 3–120, maxChoices 2–6), drops values outside the enums, and accepts subject codes only from `subjectsFor(school)`. A request with only `instructions` may omit `type`, and the interpretation then chooses it.
3. **Precedence.** Explicit form fields, meaning the keys the caller actually sent, win over interpreted fields. Interpreted fields win over the profile, and the profile wins over age-band defaults:
   - **school:** the profile.
   - **support:** the profile's support preferences, merged field by field.
   - **difficulty:** the subject level's `relativeLevel`, otherwise 3.
   - **duration:** `support.sessionMinutes`.
   - **count:** the age-band default (early 6, middle 10, upper 12). When only a duration is given, the count is derived from it (1.5, 2 or 2.5 minutes per item).
   - **item kinds:** per artifact type. Early learners get no free text except in writing tasks and projects.
4. **Approval default.** New F–3 learners (early band) get `generation.approval: 'parent'`; others `immediate` (`defaultGeneration`).
5. **Name scrubbing.** The learner's display name is replaced with "eleven" in `instructions`, `topic` and `theme` before anything reaches a model.

The fully resolved request is stored on the artifact row (`request`). Transforms and item regeneration start from this stored request.

## Prompt architecture

There is one system prompt per artifact, which all its calls share. It is assembled from blocks in `prompts/index.ts`. Bump `PROMPT_VERSION` (now `generation/v4`) whenever the wording changes; every artifact version stores it.

| Block             | Content                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `roleBlock`       | A Swedish teacher who outputs strict JSON with correct, unambiguous answers                                                                       |
| `ageBlock`        | Stage and year, plus tone per age band (early: short and warm; middle: clear, not childish; upper: adult and subject-precise)                     |
| profile           | `promptProfile()` only: compact, without the name, strengths or difficulties. Learner histories are never sent                                    |
| `supportBlock`    | Presentation, kept separate from difficulty: text amount, visual support (asks for illustration suggestions), max choices, step by step, …        |
| `interestBlock`   | Theme or interests. For young learners they are a natural theme; for older learners they are optional and subtle                                  |
| `settingsBlock`   | Difficulty, hints on or off, feedback timing, duration, subject and topic, skill-tag format                                                       |
| `languageBlock`   | Swedish by default. Language subjects (e.g. `GRGRENG01`) or non-Swedish material use the target language where it is pedagogically right (`lang`) |
| `curriculumBlock` | Real central-content texts from the curriculum store, as local ids `C1…Cn`. The model may cite only these ids                                     |
| `sourceBlock`     | Source-mode rules plus the processed material segments `[segId] (sida n, kind) text`                                                              |
| `safetyBlock`     | No violence, weapons or combat focus (fighter aircraft are treated as engineering and aviation), age-appropriate content, no personal data        |

The user message is the task for each call: `textsTask` (section bodies), `itemsTask` (N items of the allowed kinds), `repairTask` (replace the failing items), and `transformContext` (the previous version plus the transform instruction).

**Curriculum offering** (`offerCurriculum`):

- It starts with the adult-chosen refs and the refs derived from the material, provided `isValidRef` accepts them.
- It then adds `suggestRefs` hits for the topic, instructions and material concepts.
- If the search finds nothing and a subject is set, it falls back to that subject's central content.
- At most 10 refs are offered. Cited ids that were not offered are dropped server-side.

## Structured output

The model never produces contract items directly. `items.ts` defines a smaller schema:

- There are no ids, sources or media.
- Choices are plain strings with `correctIndex` or `correctIndexes`.
- Ordering items are given in the correct order; the server shuffles them deterministically.
- Each item may carry `curriculumIds`, `sourceSegmentIds` and an `illustration` suggestion.
- The schema is a union of only the allowed kinds, so the model cannot produce other kinds. The item count is exact (`minItems = maxItems`).

`toItem` assigns ids (`i1`, `i2`, …) and the other server-side fields:

- `upload` SourceRefs: the study set, page, segment id and a short excerpt.
- `curriculum` SourceRefs and `curriculumRefs`.
- A `model` source when nothing else applies.
- It also trims choices to `support.maxChoices`, always keeping the correct ones.
- **Skills:** when the request has `skills` (learning paths, remediation, reviews), the prompt asks for those tags, and `itemSkills` enforces them: an item keeps the model's tags that equal or refine a requested tag (only the finest of a chain, since the adaptive roll-up would otherwise count one answer twice); an item with none of them gets the requested tags.

### Blueprint (sections)

| Type                                  | Sections                                                                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `lesson`                              | `intro` → `explanation` → `example` → `practice` (60 % of the items) → `recap` → `check`                                                     |
| `readingComprehension`                | `text` (reading text) → `check` (N questions)                                                                                                |
| `story`, `summary`                    | `text` → `check` (≤ 3)                                                                                                                       |
| `explanation`                         | `explanation` → `example` → `check` (≤ 3)                                                                                                    |
| `writingPrompt`                       | `task` with a body and ≤ 3 free-text items                                                                                                   |
| `project`                             | `intro` → `task` (≤ 5 items)                                                                                                                 |
| `practiceTest` / `worksheet` / others | Chunks of ≤ 10 items (`CHUNK`) as `check` / `task` / `practice` sections. A large test is split into "Del 1", "Del 2", …, with one call each |

**Practice-test kinds:** items follow `kindSequence` (a smooth weighted round-robin over `itemKinds`, weights from the optional `kindMix`, equal otherwise), cut into per-chunk quotas that the item prompt states ("Fördelning: …"; free text goes last in a part). The default mix starts multiple choice, free text, …, so even short tests for åk 4+ get free text. If the model returns fewer free-text items than the quota, one extra freeText-only call replaces surplus items of other kinds. The test configurator (`src/features/study/TestConfigurator.tsx`) offers presets: Flerval (`multipleChoice`), Skriv eget svar (AI rättar) (`freeText`), Flerval + eget svar (`multipleChoice`, `freeText`, `kindMix` 7:3; default for middle/upper/adult), Låt AI välja (no `itemKinds`; default for early) and Välj själv (checkboxes). The early band is never offered free text, and `resolveRequest` drops it for early learners anyway. In strict mode free-text rubric points must come from the cited segments (they are graded against them, see runs.md).

Body length depends on the age band (early 40, middle 90, upper 160 words per base section), on `textAmount` (minimal ×0.5, reduced ×0.7), and on duration (×1.5 from 30 minutes). One `artifact_texts` call writes all the bodies. The item calls then receive those bodies as context, and they receive earlier prompts so that questions don't repeat.

## Source modes

| Mode                  | Behaviour                                                                                                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `strict`              | Questions come only from the uploaded material, and every item must cite segments. The curriculum is not offered. An item without an `upload` source is an error (`strict_source`) |
| `sourceAndCurriculum` | The upload is primary, with the curriculum as context                                                                                                                              |
| `extended`            | The upload is a topic seed, and the model may go beyond it                                                                                                                         |

The processed material comes from `ProcessedStudyMaterial`, loaded through a `MaterialLoader`. Vision is never re-run, not even for transforms. If a `studySetId` is given but no processed material exists yet, the job fails with `material_unavailable`, which is retryable.

**Large materials** (`selectMaterial`): material over the prompt budget (`MATERIAL_CHARS`, 14 000 characters), or a request naming a page range ("sida 4–7"), is cut to the segments that fit: the page range first, then the most relevant to topic, instructions and skills (BM25), shown in document order. The cut is stored on the version (`artifact_versions.truncated`: pages used, segments used/total, page range) and the adult view returns it as `materialTruncated`.

## Web research (`useWebResearch`)

In `extended` and `sourceAndCurriculum` mode, a request with `useWebResearch: true` first calls `researchBrief` (`server/research`) on the topic (else the material's topic, else the instructions). It returns `null` when `FEATURE_WEB_RESEARCH` is off or `AI_RESEARCH_PROVIDER`/`AI_TEXT_PROVIDER` is missing; then, and when research fails for any other reason, the artifact is generated without it (logged, never a job failure). Strict mode never researches.

- The checked brief goes into the system prompt (`researchBlock`) with its sources numbered `W1…Wn`. Items cite them in `webSourceIds`; `toItem` turns valid ids into `web` SourceRefs and drops unknown ones.
- The brief id is stored in the artifact's resolved request (`artifacts.request.researchBriefId`), so every version made from it (transforms, item regeneration) reuses the same brief via `loadBrief` and never searches again. The adult view of `GET /artifacts/:id` returns `researchBriefIds` for `GET /research/provenance?briefIds=…`.

## Validation, repair and approval

1. `validateArtifact(artifact, { request, material })` from `server/validation` is authoritative. The engine merges in its own `localIssues` (`strict_source`, and `answer_missing` when an answer id is not among the choices).
2. If there are errors and every error names an item, one **targeted regeneration** replaces just those items. They keep their ids, and the artifact is checked again.
3. Still invalid: the artifact is stored as `draft` with the report, and the job fails with `validation_failed`. Its adult message names the title, the error count and the first error, and says that a draft was saved.
4. Valid: the policy `immediate` makes the artifact `approved`, and `parent` makes it `pendingApproval`.

## Versions and editing

`artifacts` holds the current state: approval, current version and the resolved request. `artifact_versions` holds the full contract-validated `Artifact` for each version, together with the validation report, the illustration requests, the origin (`generate`, `edit`, `regenerateItem` or `transform:<kind>`), and server-only metadata (model, provider kind and prompt version). Approve and reject only update the row.

The rules for changing an existing artifact (edit, item regeneration, transform):

- A valid change keeps the approval state. The exception is a draft, which moves on according to the policy.
- An invalid change is stored only if the artifact is already a draft. Otherwise nothing is stored: the edit returns `422` with the report, or the job fails.
- An artifact with failing validation cannot be approved (`409`).
- **Version conflicts:** PATCH, approve and reject take the version the adult saw (body `version` or `If-Match`). If another version landed meanwhile they return `409 version_conflict` and change nothing; the adult UI then says "Materialet har ändrats. Ladda om …" and reloads. Jobs that change an artifact (transforms, item regeneration, media) store only if the version is unchanged; a lost race fails retryable (`version_conflict`).
- Jobs write their final result through `tools.assertActive` inside the transaction, so a cancelled or timed-out job stores nothing. A retried `artifact.generate` reuses the artifact an earlier attempt stored (`artifacts.job_id` is unique).

## HTTP

| Route                                                         | Who            | Result                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/v1/learners/:id/generate`                          | adult/learner¹ | `202 { jobId }`. The body is a `GenerationRequest` (`learnerId` is taken from the path)                                                                                                                                                                                                                                                                                                    |
| `GET /api/v1/learners/:id/artifacts?type=&approval=&subject=` | any            | Summaries. Learners see only `approved`                                                                                                                                                                                                                                                                                                                                                    |
| `GET /api/v1/artifacts/:artifactId`                           | any            | Adult: `{ artifact, requestedIllustrations, researchBriefIds, assetIds }` (the ids feed `GET /research/provenance`). Learner: `404` unless approved (and, with `?learnerId=`, unless it belongs to that learner; learner screens always send it); returns `{ artifact }` without the validation report, run through `forLearner` (no answers, rubrics or explanations) when `feedback=end` |
| `GET /api/v1/artifacts/:artifactId/versions`                  | adult          | Version history (version, origin, validation, createdAt)                                                                                                                                                                                                                                                                                                                                   |
| `POST /api/v1/artifacts/:artifactId/approve` / `reject`       | adult          | The artifact. Approve returns `409` while validation fails                                                                                                                                                                                                                                                                                                                                 |
| `PATCH /api/v1/artifacts/:artifactId`                         | adult          | `{ title?, sections?: [{ index, title?, body? }], items?: { [itemId]: fields }, removeItems?: [] }` creates a new version. Returns `400` for contract breaks or unknown items, and `422` for failed validation                                                                                                                                                                             |
| `POST /api/v1/artifacts/:artifactId/items/:itemId/regenerate` | adult          | `202 { jobId }` (`artifact.regenerateItem`). Same kind, same id                                                                                                                                                                                                                                                                                                                            |
| `POST /api/v1/artifacts/:artifactId/transform`                | adult          | `{ kind, theme? }` returns `202 { jobId }`. The kinds are `simplify`, `harder`, `easier`, `moreVisual`, `changeTheme` (needs `theme`), `shorten`, `expand` and `more`. `more` creates a new artifact; the others create a new version. All reuse the stored artifact and the processed material                                                                                            |

¹ A learner may use this route only with `learnerRequestsAllowed`.

## Illustrations

Items may suggest an illustration. The suggestion is stored per version as `{ itemId, description }` (`artifact_versions.illustrations`), because `MediaRef` cannot express a placeholder. `requestedIllustrations(stored)` returns the suggestions for items that have no media yet.

Code: `media.ts`. The flow, when the request has `includeImages` or the resolved support has `visualSupport: 'high'`:

1. **Enqueue** (`enqueueIllustrations`, at the end of `artifact.generate`, transforms and `artifact.regenerateItem`, only for a valid stored version): each open request (at most `MAX_ILLUSTRATIONS` = 12 per version) becomes a slot `sections.S.items.I` with its `itemId`, screened with `screenRequest` (`server/images`):
   - decorative → `image.generate` via `illustrationJobsFor`, only when image generation is available;
   - `factual_reference` (real aircraft, maps, finds, …) → `asset.fetch` (`findLicensedImages`, licensed images only), only when `FEATURE_EXTERNAL_ASSETS` is on;
   - `unsafe_content` → nothing.
     Enqueue problems (queue full) are logged; generation never fails because of images.
2. **Apply** (`applyJobMedia`, the worker's completion hook for both job types, see below): loads the asset (`resultId`), checks that the request still stands (the item exists and its current illustration request has the same description; a transform or edit that changed it makes the job a no-op), finds the item's current path by `itemId`, inserts the media with `applyGeneratedMedia`, revalidates and stores a **new version** (`origin: 'media'`). The version is stored only if the artifact's version did not change in between (`addVersion(..., { expectVersion, keepApproval: true })`, retried up to 3 times), so concurrent image jobs never overwrite each other and an approval given meanwhile is kept. Already-present media (a replayed completion) produce no version, and media that would turn a valid artifact invalid are not applied.
3. **Failure:** a failed image or asset job changes nothing: the artifact stays usable without the picture, and the request stays open (`requestedIllustrations`).

**Completion hook design.** `JobHandler.onCompleted(job, resultId, { db, log })` (`server/jobs/runtime.ts`) runs after `run` succeeds and before the job is marked completed, so it runs at least once (a crash re-runs the job) and must be idempotent; never after a failure or cancel. A throw fails the attempt as retryable. The hooks are composed in `server/worker/handlers.ts` (`ON_COMPLETED`), the one module that already imports every domain, so `images` and `research` never import `generation` (no cycles). Runs started on an earlier version keep that version.
