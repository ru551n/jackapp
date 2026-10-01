# Interactive runs

A **run** is one learner working through one version of a generated artifact (practice test, exercises, flashcards …): answering, getting calm feedback and hints, and finishing with a non-punitive summary. Code: `server/runs/` (contracts in `api.ts`, checking in `check.ts`, flow in `routes.ts`). Tables: `runs`, `run_answers` (`server/db/schema/runs.ts`).

## API

All routes live under `/api/v1/learners/:id`. Request/response zod schemas are exported from `server/runs/api.ts`.

| Route                       | Who     | Body / result                                                                                                                                                         |
| --------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /runs`                | learner | `StartRunRequest { artifactId }` → `RunView` (201). An active run for the same artifact is resumed (200). Learner mode: approved artifacts only (403 `not_approved`). |
| `GET /runs/:runId`          | learner | `RunView`. While active, items are the public view: no answers, hints, rubric, sample answer or explanation; matching/ordering options are shuffled.                  |
| `POST /runs/:runId/answers` | learner | `SubmitAnswerRequest { itemId, attempt?, answer }` → `AnswerFeedback`. `answer` is validated against `AnswerByKind[item.kind]`.                                       |
| `POST /runs/:runId/hint`    | learner | `HintRequest { itemId }` → `HintResponse { hint, hintsShown, more }`.                                                                                                 |
| `POST /runs/:runId/finish`  | learner | → `RunSummary`. Idempotent.                                                                                                                                           |
| `POST /runs/:runId/abandon` | learner | → `{ state }`. No penalty: answers are kept, unsettled items record no evidence.                                                                                      |
| `GET /runs?artifactId=`     | adult   | History: runs with every attempt. `assessedBy` is `auto`, `self`, `ai` (advisory) or `pending`.                                                                       |

Answer shapes (`AnswerByKind`): multiple choice = choice id; multi-select = choice ids; true/false = boolean; fill-blank = one string per blank; matching = chosen right side per pair, in left order; ordering = item ids; numeric = string or number; free text = `{ text, selfRating? }`; flashcard = `knew | partly | notYet`.

## Feedback modes

- **Immediate** (`artifact.feedback = 'immediate'`): every answer returns correct/score and a calm message. A miss returns "Prova igen." (or "Nästan! Prova igen." for partial credit) plus the next unused hint. After `REVEAL_AFTER[ageBand]` tries (early 3, middle 3, upper 4; `server/runs/routes.ts`) the answer is revealed with the explanation. A solved item shows the solution and explanation.
- **End**: answers are stored and may be changed; the response is only "Svaret är sparat." with `correct: null`. Finish settles the latest answer of every item.

Learners never see the word "fel" (tests assert it); model feedback containing it is replaced.

## Checking

Deterministic per item kind (`check.ts`). `correct` means full score.

| Kind           | Policy                                                              |
| -------------- | ------------------------------------------------------------------- |
| multipleChoice | exact choice id                                                     |
| trueFalse      | exact boolean                                                       |
| multiSelect    | partial: `max(0, (right picks − wrong picks) / correct count)`      |
| ordering       | all or nothing                                                      |
| matching       | per-pair credit                                                     |
| fillBlank      | per-blank credit; any accepted variant after normalization (below)  |
| numeric        | parsed (below), `abs(value − answer) ≤ tolerance` (+ float epsilon) |
| flashcard      | self-rated: knew 1, partly 0.5, notYet 0                            |
| freeText       | advisory AI assessment, or self-rating (below)                      |

**Text normalization (fill-blank):** Unicode NFC, case-insensitive, whitespace collapsed and trimmed, trailing `. ! ?` ignored, diacritics stripped (café = cafe) **except å, ä and ö**, which are separate Swedish letters: `här` ≠ `har`, `köra` ≠ `kora`. Capitalization is not graded.

**Numbers:** comma or dot decimals (`3,5`), space thousands (`1 000`), fractions and mixed numbers (`3/4`, `1 1/2`, `½`), Unicode minus. A trailing unit must match the item's `unit` (case and spaces ignored); a missing unit is accepted, a different unit is not (no conversion).

**Free text:** the model gets the prompt, numbered rubric, sample answer and the learner's text (as data) and must return `FreeTextAssessment { keyPointsMet (rubric indices), feedback (short encouraging Swedish), score 0..1 }`. Correct = all key points met. The result is stored with `aiAssessed: true` and shown to adults as advisory. When AI is not configured, fails or returns invalid output, the response carries `selfAssess { rubric, sampleAnswer }` and the answer stays pending (`correct: null`); the learner resubmits the same attempt with `selfRating`. The run never fails because of AI. In end mode the rubric stays hidden until finish; pending items are then listed in `RunSummary.selfAssess` and can be rated after finishing.

## Evidence

When an item's outcome is settled (`run_answers.final`), one `skill_evidence` row per skill tag is written via `recordEvidence` in the **same transaction** as the answer, so a failure leaves neither. `misses` = attempts before solving (immediate), or 0/1 (end mode); `hintsUsed` = hints shown for the item. Settled means: solved, revealed, rated (flashcard, free text), or attempted-but-unsolved at finish. Unanswered, pending and abandoned items record nothing.

## Concurrency

Every mutation locks the run row (`SELECT … FOR UPDATE`). With `attempt` set, resubmitting an existing (itemId, attempt) replays the stored feedback; `run_answers` is unique on (runId, itemId, attempt). One active run per learner and artifact (partial unique index); starting again resumes it.

## Wiring the artifact loader

Runs do not import `server/generation`. The app context has an optional `loadArtifactVersion(db, artifactId, version?) => Promise<Artifact | undefined>` (`ArtifactLoader` in `routes.ts`); omitted `version` means the version to start a run on (normally the latest approved one). Approval is read from `artifact.approval === 'approved'`. Without a loader the routes answer 503 `not_configured`.
