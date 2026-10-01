# Frontend plan (web app in `src/`)

One React app, hash routing, Swedish UI. The API is under `/api/v1` (`src/api/client.ts`). Jobs are followed with `useJob(jobId)` (`src/api/useJob.ts`, SSE with polling fallback). For local development, run `npm run dev:all` (API + worker + PGlite + mock AI on :3000) together with `npm run dev` (Vite, which proxies `/api`).

## Top-level routes (`src/app/App.tsx`, owned by the orchestrator)

| Route             | Area                                                                                                                                                                                              | Owner folder            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `/`               | Start: first-run setup (create the adult PIN and the first learner), else the learner picker "Vem ska lära sig?" with large cards and a small "För vuxna" link                                    | `src/features/start/`   |
| `/vuxen/*`        | Adult area behind the PIN gate: learners and profiles, support preferences, approvals, editing generated material, generation requests, progress and gaps, learning paths, uploads, system status | `src/features/adult/`   |
| `/l/:learnerId/*` | Learner area. The shell is chosen by **age band** (`early`, `middle`, `upper`), and presentation comes from the learner's support preferences                                                     | `src/features/learner/` |

Shared components used by both areas: study upload and material view, test configuration, and the run player (all 10 item kinds) live in `src/features/study/` and `src/features/runs/`.

## Age bands

- **early** (F–3): the existing JackApp experience (Stationen, Tunnelbanan, Spårvagnen, Flygplatsen, Engelska, Min samling, Bygg din linje) plus AI material presented the same calm way: large controls, few choices, pictures, read-aloud, special-interest themes, gentle collection rewards.
- **middle** (4–9): more density and autonomy, meaningful progress, optional themes, own requests ("Jag vill lära mig bråk med flygplan").
- **upper** (gymnasium): a mature, efficient study dashboard. Upload material → practice test, revision, detailed results, minimal gamification.

Support preferences (reduced text, high visual support, max choices, read-aloud, reduced motion, step-by-step, no time pressure) apply in **every** band and are independent of age and difficulty.

## Existing early-years data

The original app keeps progress in `localStorage['jackapp:v1']`. It now becomes per-learner storage (`jackapp:v1:<learnerId>`). On first use, the old global key is offered to an early-band learner and also imported to the server (`POST /learners/:id/legacy-import`, adult). Nothing is deleted silently. The old in-app parent page and its local PIN are replaced by the adult area and the household gate.

## Rules

- Calm UX everywhere: no timers, no red, never "fel" for learners, "Prova igen".
- Errors: learners see "Det gick inte att skapa uppgiften just nu.", adults see the API message.
- Keyboard, focus management, `lang` attributes, reduced motion and touch targets ≥ 44 px, as in the existing app.
- No technical AI details in the UI. Adults see capability labels from `/system/status`.
