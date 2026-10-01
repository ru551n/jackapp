# Adaptive learning

Code: `server/adaptive/` (`skills.ts` model and detectors, `steps.ts` next steps, remediation and spaced review, `paths.ts` learning paths, `routes.ts`). Tables: `skill_evidence` (shared), `skill_evidence_kinds`, `adaptive_legacy_skills`, `skill_reviews` and `learning_paths` (`server/db/schema/adaptive.ts`).

Principles: status comes from deterministic, explainable rules. AI only plans path milestones and never decides mastery. Text shown to people is qualitative Swedish with evidence counts ("Verkar behöva mer träning på tiotalsövergångar (6 svar, 4 med hjälp)"). It never contains decimals or percentages. Academic difficulty and presentation support are separate: support preferences pass through unchanged, and difficulty comes from the evidence.

## Per answer

Each `SkillEvidence` row becomes one outcome:

| Outcome  | Rule                                                            |
| -------- | --------------------------------------------------------------- |
| `first`  | correct, 0 misses, 0 hints                                      |
| `helped` | not correct (revealed), or 2 or more misses, or 2 or more hints |
| `retry`  | everything else (1 miss or 1 hint)                              |

## Status (`judge`)

The status uses the **newest 10 answers** of a skill. Each answer has an integer recency weight: **4** if it is at most 14 days old, **2** if it is at most 60 days old, and **1** if it is older.

| Status         | Rule (checked in this order)                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `new`          | fewer than 3 answers                                                                                                         |
| `needsSupport` | at least 2 `helped` answers **and** the `helped` weight is at least a third of the total weight                              |
| `secure`       | at least 5 answers, the `first` weight is at least three quarters of the total weight, and the newest answer is not `helped` |
| `practising`   | everything else                                                                                                              |

So old struggles fade: 5 helped answers from three months ago followed by 5 first-try answers this week give `secure`.

**Roll-up:** tags are hierarchical (`math.addition.tens-crossing`). Every parent (`math.addition`, `math`) gets a summary over the pooled answers of all its descendants, with the same rules. `evidenceCount` counts all answers, including legacy attempts.

## Pattern detectors

These are deterministic. They are returned by `GET /learners/:id/skills` as `patterns`.

| Code                               | Fires when                                                                                                                                                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wordRecognitionOverComprehension` | `<parent>.word-recognition` is `secure` while `<parent>.comprehension` is `needsSupport`                                                                                                                                                  |
| `recallOverExplanation`            | per root tag: among the newest 20 recall answers (choice, fill-in, matching, ordering, numeric, flashcard), at least 5 answers and three quarters first-try; among the newest 10 `freeText` answers, at least 3 answers and half `helped` |
| `hintsOverused`                    | hints are used in at least half of the newest 20 answers, with at least 6 answers                                                                                                                                                         |
| `harderItemsFail`                  | per root tag, newest 30 answers: at difficulty 4 or above, at least 3 answers and half `helped`; at difficulty 3 or below, at least 3 answers and at most a quarter `helped`                                                              |

Item kinds are not part of `SkillEvidence`. Pass `itemKind` to `recordEvidence` and it is stored in `skill_evidence_kinds`.

## Legacy progress

`legacy_skill_progress` (the old first-grade app) is converted into `adaptive_legacy_skills` the first time a learner's skills are read. A row is converted again only when it comes from a newer import. Old ids map to tags (`math.add` → `math.addition`, `read.words` → `swedish.reading.word-recognition`, `read.sentences` → `swedish.reading.comprehension`, …; see `LEGACY_SKILL_MAP`). Unknown ids become `legacy.<id>`. The kept `recent` outcomes (up to 6) are judged like live answers, dated at `lastPracticed`. The remaining attempts only count towards `evidenceCount`.

## Next steps (`GET /learners/:id/next`)

Steps are ranked in this order, at most 2 per kind and 6 in total:

1. **remediate**: leaf skills that are `needsSupport`, with the most `helped` answers first.
2. **review**: spaced reviews that are due, the oldest first.
3. **continuePath**: the active milestone of each active path.
4. **explore**: a curriculum subject for the learner's year (`subjectsFor`) that has no evidence and no path yet. There are 2 such steps when nothing else is suggested.

Each step carries a Swedish `reason` for adults, a `childText` and a ready `GenerationRequest` draft (`request`). The skill tags are in `request.instructions`, because `GenerationRequest` has no skills field. Learner mode gets `{ kind, title, text, pathId? }` only.

## Remediation (`remediationRequest(summary, profile, { difficulty? })`)

This builds a `lesson` in a fixed order: easier representation → worked example → guided practice → repeated practice → final check. The difficulty is one step below the median difficulty of recent answers (minimum 1). The number of questions follows `repetition` (low 5, normal 8, high 12). The support preferences pass through unchanged. They are also restated in the instructions: max choices, text amount, visual support and step by step. `textAmount` other than `normal` drops `fillBlank` and adds `trueFalse`. `visualSupport: high` sets `includeImages`.

## Spaced review

Intervals are **1, 3, 7, 14 and 30 days** (`REVIEW_INTERVAL_DAYS`). A leaf skill gets a review the first time it is `secure`, due 1 day after its newest answer. Each time evidence arrives, the answers since the last update decide the next step:

- any `helped` answer → back to 1 day
- all `first` → the next interval (at most 30 days)
- otherwise → the same interval

The due date is counted from the newest answer.

## Learning paths

`POST /learners/:id/paths { goal, subjectCode?, targetDate?, studySetId? }` → `202 { jobId }`. The `path.plan` job's `resultId` is the new path id. The text AI proposes milestones under a strict schema. Then `checkPlan` validates the proposal deterministically:

- 1–12 milestones
- each milestone has at least one skill
- skill tags match `^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*){1,5}$` (at least two levels)
- `refIds` exist in the candidate list given to the model, which comes from `suggestRefs` for the goal
- dates are real calendar dates, not in the past, not decreasing, and not after `targetDate`

If any check fails, the job fails with `ai_invalid_output` and no path is stored.

**Lazy content:** only the active milestone has generated content. When a milestone becomes active, one `artifact.generate` job is enqueued with payload `{ request: GenerationRequest }` and `dedupeKey path:<pathId>:<milestoneId>`. The path's `artifactIds` come from the job's `resultId` once it completes.

**Adaptation (`onEvidence(db, learnerId)`):** call this after recording evidence. It is cheap and deterministic.

- It reschedules reviews.
- A goal milestone is done when all its skills (rolled up) are `secure`. The next milestone is then activated, or the path is completed when none is left.
- If a skill of the active goal milestone is `needsSupport` with at least 4 answers since activation, a remediation milestone (a `remediationRequest`) is inserted before it. This happens at most once per skill and path.
- A remediation milestone is done when the skill is no longer `needsSupport` and has at least 3 answers since activation. The original milestone then becomes active again, without new generation.
- Paths updated concurrently are skipped (optimistic check on `updated_at`).

## API

| Route                                            | Access                                                     | Result                                                           |
| ------------------------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------- |
| `GET /api/v1/learners/:id/skills`                | adult                                                      | `{ skills: SkillSummary[], patterns: Pattern[] }`                |
| `GET /api/v1/learners/:id/next`                  | anyone                                                     | adult: `NextStep[]`; learner: `{ kind, title, text, pathId? }[]` |
| `POST /api/v1/learners/:id/paths`                | adult, or learner when `generation.learnerRequestsAllowed` | `202 { jobId }`                                                  |
| `GET /api/v1/learners/:id/paths`                 | anyone                                                     | `LearningPath[]`, newest first                                   |
| `GET /api/v1/learners/:id/paths/:pathId`         | anyone                                                     | `LearningPath`                                                   |
| `POST /api/v1/learners/:id/paths/:pathId/pause`  | adult                                                      | `LearningPath` (`409` unless active)                             |
| `POST /api/v1/learners/:id/paths/:pathId/resume` | adult                                                      | `LearningPath` (`409` unless paused)                             |
| `DELETE /api/v1/learners/:id/paths/:pathId`      | adult                                                      | `204`                                                            |
