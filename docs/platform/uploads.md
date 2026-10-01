# Study-material uploads (`server/study`)

An adult uploads photos or PDFs of study material (textbook pages, worksheets, notes) for a learner. The worker turns them into a `ProcessedStudyMaterial` (`shared/contracts/study.ts`): ordered, page-traceable segments plus a summary, concepts and validated curriculum refs. Every later generation works from that representation; vision never runs again for the set.

Code: `routes.ts` (HTTP), `process.ts` (`study.process`, `uploads.cleanup`), `service.ts` (shared helpers). Tables: `server/db/schema/study.ts`.

## Lifecycle

```
POST upload ──► uploading ──► queued ──claim──► processing ──commit──► ready ──► originals deleted
                 │ (rejected:      ▲                │
                 │  row + files    │ retry/backoff  └──► failed ──(reprocess)──► queued
                 │  removed)       └────────────────────────┘ │
                 ▼                                            └──(retention)──► originals purged
```

1. **Upload** (adult): the request is streamed part by part to `DATA_DIR/uploads/<setId>/<n>.upload`, hashing (sha256) and counting bytes on the way. Each file is then typed by **magic bytes** (JPEG, PNG, WEBP, PDF; the name and client mime type are ignored). A PDF becomes one page per PDF page (`pdfinfo` counts them). Pages are numbered in upload order. Any rejection deletes the set row and its directory.
2. **Queue**: the set becomes `queued` and `study.process` is enqueued with `dedupeKey: study.process:<setId>`. The response is `201 { set, jobId }`; the UI follows `GET /api/v1/jobs/:jobId/events`.
3. **Process** (worker), per page in order, with progress `Läser sida 3 av 12`:
   - Cache lookup on `(sha256 of source file, pdfPage or 0)` in `study_page_extractions`. A hit skips rendering and vision entirely.
   - Otherwise render: PDF pages with `pdftoppm -scale-to 2000 -png`; images with `sharp` (EXIF rotate, long edge ≤ 2000 px, JPEG re-encode). The PDF text layer (`pdftotext -layout`) is passed to vision as a hint.
   - One vision call per page with a strict zod schema (`StudySegment` minus id/page): faithful transcription, segment kind, LaTeX for formulas, vocabulary pairs, table rows, described diagrams/maps, handwriting, confidence. The result is cached.
   - One text call over all segments (capped at 60 000 characters) produces language, subject, topic, summary and concepts. Curriculum refs: the model only picks **indexes** into the `suggestRefs` candidates, and every chosen ref is re-checked with `isValidRef`. The subject must be one of the learner's `subjectsFor` codes or it is dropped.
   - The result is validated against `ProcessedStudyMaterial`, then stored in **one transaction** (material, segments, `status = ready`, guarded by `status = 'processing'` so a deleted set cannot be resurrected).
   - **Only after the commit** the originals directory is removed, pages get `sourceDeleted = true` and the set gets `sources_deleted_at`.
4. **Failure**: retryable AI errors (`ai_unavailable`, `ai_rate_limited`) put the set back to `queued` while the job has attempts left; worker shutdown does the same. Anything else marks the set `failed` with a safe Swedish `failure`, stamps `failed_at` and **keeps the originals** for `reprocess` and diagnostics.

Segment ids are `p<page>s<n>` and never change once a set is `ready` (originals are gone, so it cannot be reprocessed). Generated content references them as `SourceRef { kind: 'upload', studySetId, page, segmentId }`; `segmentSource()` in `service.ts` builds one.

## Routes

All under `/api/v1/learners/:id/study-sets`.

| Route                    | Who    | Does                                                                                                                       |
| ------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| `POST /`                 | adult  | multipart upload (`files` parts in order, optional `title` field) → `201 { set, jobId }`                                   |
| `GET /`                  | anyone | `StudySet[]`, newest first                                                                                                 |
| `GET /:setId`            | anyone | `{ set, jobId }`                                                                                                           |
| `PATCH /:setId/pages`    | adult  | `{ order: [4, 1, 2, 3] }` (current page numbers in new order); only while `queued` or `failed`, else `409 not_reorderable` |
| `POST /:setId/reprocess` | adult  | `202 { set, jobId }` for a `failed` set whose originals still exist, else `409 not_reprocessable`                          |
| `DELETE /:setId`         | adult  | `204`; cancels the job, removes rows, originals and extraction-cache rows no other page uses                               |
| `GET /:setId/material`   | anyone | `ProcessedStudyMaterial`; adults also get `provenance` (method, models, pages, cached pages). `409 not_ready` before ready |

The reorder takes a row lock on the set; the worker's `queued → processing` update waits for it, so a reorder either lands before processing reads the pages or is refused.

## Limits and errors

From `server/config/limits.ts` (read per request): `LIMIT_UPLOAD_FILE_MB` per file, `LIMIT_UPLOAD_TOTAL_MB` per set, `LIMIT_UPLOAD_PAGES` pages per set (PDF pages count individually).

| Status | Code                | When                                                         |
| ------ | ------------------- | ------------------------------------------------------------ |
| 413    | `file_too_large`    | a file is over the per-file limit                            |
| 413    | `upload_too_large`  | the set is over the total limit (checked while streaming)    |
| 413    | `too_many_pages`    | more pages (or files) than the page limit                    |
| 400    | `unsupported_type`  | not JPEG/PNG/WEBP/PDF by magic bytes; HEIC gets its own hint |
| 400    | `upload_unreadable` | PDF that poppler cannot open (corrupt, encrypted)            |
| 400    | `invalid_request`   | not multipart, or no files                                   |

**HEIC** is rejected: sharp's prebuilt libvips has no HEVC decoder (patents), and adding `libheif` plus a custom libvips build is not worth it. The message tells the adult to save as JPEG (iPhone: Kamera → Format → Mest kompatibelt).

## Text-layer path (no vision)

Without `AI_VISION_*`, a set is still processed when **every page is a PDF page with a text layer** of at least 20 non-space characters. Each page's `pdftotext -layout` output is split into paragraph `text` segments (confidence `high`, no kinds, no diagrams). Provenance records `method: 'text-layer'`. Any image page, or a scanned PDF page without text, fails with "Bildtolkning (AI-vision) är inte konfigurerad." The text capability is always required.

## Retention guarantees

- **Success:** originals are deleted right after the commit. If that delete fails, `uploads.cleanup` finishes it.
- **Failure:** originals are kept for `UPLOAD_FAILED_RETENTION_HOURS` (default 168) after `failed_at`, then purged by `uploads.cleanup` (hourly). Purged sets cannot be reprocessed.
- **Never a live set:** the purge is a single `UPDATE … WHERE status = 'failed' AND sources_deleted_at IS NULL AND failed_at < cutoff RETURNING`. `reprocess` and the worker's claim both require `sources_deleted_at IS NULL`, and the worker only processes `queued`/`processing`/`failed` rows. Postgres row locks serialize these, so a set is either claimed for purge or for processing, never both.
- **Stuck sets:** a `queued`/`processing` set untouched for an hour **without an active `study.process` job** (worker lost with attempts used up, timeout) is marked `failed`, which starts its retention window.
- **Interrupted uploads:** `uploading` rows older than an hour are deleted with their directory.
- **Orphans:** directories under `DATA_DIR/uploads` with no set row (older than an hour) or belonging to a set whose originals were already released are removed.
- **Delete:** removes everything at once, including cache rows whose sha256 no other page references.

The extraction cache is household-wide: the same page uploaded again for any learner reuses it.

## Privacy

Logs carry set ids, page counts, cache hits, durations and failure codes only. Uploaded content, extracted text, prompts and file names are never logged.

## Deployment

The runtime image already has `poppler-utils` (`pdfinfo`, `pdftoppm`, `pdftotext`). `sharp` is native and **external** to the server bundle (`scripts/build-server.mjs`), so the runtime image needs `node_modules/sharp` and its `@img/*` platform packages next to `dist-server/`; it is loaded lazily, only by the worker when it renders a page.
