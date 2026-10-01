# Learner profiles

Every learner belongs to the household. Code: `server/learners/` (routes, profile service, legacy import), tables `learners` (core) and `legacy_progress`, `legacy_skill_progress`, `household_settings` (`server/db/schema/learners.ts`).

## Profile fields

The profile is `LearnerProfileInput` (`shared/contracts/learner.ts`), validated on every write:

- `displayName`, `school` (`{ stage, year }`; the age band `early`/`middle`/`upper` is derived from it and drives the UX family).
- `interests`, `themes`: free text, max 30 items of 60 chars. Trimmed, blanks and case-insensitive duplicates dropped. A small denylist (`unsafeThemes` in `profile.ts`) rejects obviously unsafe themes (`400 unsafe_theme`) so they never reach AI prompts. Adults are trusted; this is not moderation.
- `strengths`, `difficulties`: adult notes, functional only (no medical or diagnostic data). Never sent to learners or AI prompts.
- `subjectLevels`: **academic level** per subject (description + optional 1–5 relative level).
- `support`: **presentation support** (text amount, visual support, max choices, read-aloud, pace, step by step, …). It changes how material looks and is paced, never how hard the concepts are. Academic level and support are deliberately separate: a learner can work above year level with minimal text.
- `generation`: whether the learner may request material, and whether it needs adult approval.

## Routes

| Route                                     | Who    | Returns                                                                                             |
| ----------------------------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| `GET /api/v1/learners`                    | anyone | picker list: `{ id, displayName, school, ageBand }[]`                                               |
| `GET /api/v1/learners/:id`                | anyone | adult: full `LearnerProfile`. Otherwise the learner view below                                      |
| `POST /api/v1/learners`                   | adult  | `201` full profile                                                                                  |
| `PATCH /api/v1/learners/:id`              | adult  | partial update; `support` and `generation` merge field by field; the merged profile is re-validated |
| `DELETE /api/v1/learners/:id`             | adult  | `204` (cascades to legacy data)                                                                     |
| `POST /api/v1/learners/:id/legacy-import` | adult  | `201` new import / `200` already imported: `{ importId, created, skills, skipped }`                 |

Learner view (not adult): `{ id, displayName, school, ageBand, language, presentation, learnerRequestsAllowed }`. It leaves out strengths, difficulties, subject levels and the approval policy: learner screens need only presentation.

## Profile service (`server/learners/profile.ts`)

- `presentationFor(profile)`: effective presentation settings = `support` + `ageBand` + `school`.
- `promptProfile(profile)`: compact Swedish summary for AI prompts: stage/year, age band, subject levels, interests/themes and support needs phrased functionally (e.g. "korta texter, högst 3 svarsalternativ"). It never includes the display name (also scrubbed from included free text, incl. genitive "-s"), strengths or difficulties.

## Legacy import

The old web app stored everything in `localStorage['jackapp:v1']` (`AppState` v1, `src/core/types.ts`). The frontend reads that string, `JSON.parse`s it and posts the object to `POST /api/v1/learners/:id/legacy-import`.

- **Validation** (`LegacyAppState` in `legacy.ts`): `version` must be `1`; every other field may be missing, but a present field of the wrong type (e.g. `progress: "x"`, negative missions) is a corrupt payload (`400`). Unknown fields are kept.
- **Lossless copy:** the payload, minus `parentPin`, goes into `legacy_progress.data` (jsonb) with `version`, `importedAt` and `payloadHash` (sha256). Unique on `(learner_id, payload_hash)`: re-posting the same payload returns the existing import (`created: false`).
- **parentPin** is discarded, never stored and never used as the household PIN (see `gate.md`).
- **Normalized skills:** each readable `progress[skill]` becomes one `legacy_skill_progress` row (primary key `learner_id, skill`; a newer import replaces it):

| `SkillProgress` (v1) | column              | note                                     |
| -------------------- | ------------------- | ---------------------------------------- |
| key (`SkillId`)      | `skill`             | e.g. `math.add`, kept as-is              |
| `level` (1–5)        | `level`             | required; entries without it are skipped |
| `attempts`           | `attempts`          | default 0                                |
| `firstTry`           | `first_try`         | default 0                                |
| `hintsUsed`          | `hints_used`        | default 0                                |
| `recent`             | `recent` (jsonb)    | only `first`/`retry`/`helped` kept       |
| `levelLocked`        | `level_locked`      | default false                            |
| `lastPracticed` (ms) | `last_practiced_at` | timestamptz                              |
| —                    | `import_id`         | the `legacy_progress` row it came from   |

Skipped skill keys are returned in `skipped` and still exist in the raw copy. Missions, sessions, settings and the free-play line live only in the raw copy for now; collection unlocks are derived from missions, as before. Turning this into `SkillEvidence` is the adaptive module's job.
