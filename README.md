# JackApp

A calm learning web app for a Swedish first grader who loves trains, metros, trams, airliners and fighter aircraft. Transport is not a reward after learning. It is the world the learning happens in.

- **Audience:** a child in Swedish årskurs 1 (designed for an autistic child in a special-education class; usable independently), with a separate parent area.
- **Language:** the UI is Swedish. English is taught as a subject in its own area.
- **Privacy:** no accounts, no backend, no analytics, no AI calls. Everything is stored in the browser on the device.

## Run

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # static site in dist/ (hash routing + relative paths: host anywhere, even a subfolder)
npm run preview      # serve the production build
```

## Test

```bash
npm run check        # typecheck + oxlint + prettier --check + vitest
npm run test:e2e     # Playwright on a production build (tablet 1024×768 and phone profiles)
```

First e2e run: `npx playwright install chromium`. CI (`.github/workflows/ci.yml`) runs both.

## What's in it

| Area               | Subject                    | Examples                                                                                                                           |
| ------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Stationen**      | Swedish reading            | letters on platform signs, station names, missing letter `T _ G`, short sentences with pictures                                    |
| **Tunnelbanan**    | Mathematics                | count cars and passengers, more/fewer, one more/less, sequences, addition and subtraction from pictures → numbers → `3 + 2 = ?`    |
| **Spårvagnen**     | Patterns and logic         | tram colour patterns, ordering trains by length, reading a tram route map, odd one out                                             |
| **Flygplatsen**    | Aviation                   | recognise Gripen, Viggen, Draken, F-16…, silhouettes, "Vilket flygplan kommer från Sverige?", gates, engines, length, first flight |
| **Engelska**       | Beginner English           | "Tryck på train." → "Tap the blue train." → "The plane is big.", colours, numbers 1–10, big/small/fast/slow, listening             |
| **Min samling**    | Collection                 | 22 real vehicles (10 Swedish rail, 12 aircraft) unlocked predictably by completing missions                                        |
| **Bygg din linje** | Free play (parent-enabled) | place and name stations, pick train/metro/tram, run the line                                                                       |

A mission ("uppdrag") is 4 short tasks: **Start → Uppgift → Återkoppling → Nästa → Klart**. Wrong answers get a calm "Prova igen" and escalating hints. Nothing is ever red or "fel". After 3 tries the answer is shown gently.

## Architecture

Vite + React + TypeScript (strict), React Router (hash), CSS modules with design tokens, a tiny store over `useSyncExternalStore` + localStorage, Vitest + Testing Library, Playwright, oxlint, Prettier. Details and decisions are in [docs/architecture.md](docs/architecture.md).

```
src/core      contracts (types.ts), skill/area catalog, seeded RNG, Swedish helpers
src/engine    adaptive difficulty + session planning (pure)
src/content   learning content: generators per area, vehicle facts
src/store     persisted state + actions
src/art       original SVG sprites and vehicle illustrations
src/ui        Shell, Button, SceneView (renders declarative scenes), SpeakButton
src/features  home, session, collection, parent, freeplay
```

### Where content lives

- **Learning activities:** `src/content/{reading,math,logic,aviation,english}/`. Each file exports `Generator`s that produce `Question` data (prompt, `Scene`, task, hints). See [docs/content-guide.md](docs/content-guide.md).
- **Transport and aircraft facts:** `src/content/vehicles/rail.ts` and `aircraft.ts`, with verified specs and `sources`. They are reused by the collection, recognition, reading, comparison and English activities.
- **Illustrations:** `src/art/sprites.tsx` (generic sprites), `src/art/vehicles/{rail,aircraft}.tsx` (per-vehicle art). All original vector drawings; no third-party images.
- **English vocabulary:** `src/content/english/vocab.ts`.

### Adding content

1. Write a `Generator` in the right area folder and add it to that folder's `index.ts`.
2. Run `npm test`. `src/content/content.test.ts` automatically checks every generator: deterministic, the answer is present, hints never remove the answer, picture choices have accessible names, every skill starts at level 1.
3. New vehicle: add it to `rail.ts`/`aircraft.ts` with `sources` and an `unlock` rule, then add its art to the matching art registry.

A future content source (curated packs, or generated content) only needs to produce `Generator`/`Question` objects that pass the same tests. The engine and UI stay unchanged.

## Adaptive difficulty

Each skill (e.g. `math.add`, `read.sentences`, `en.colors`) has its own level 1–5. There is no global level. Four first-try answers in a row → level +1. Two of the last three needing strong help → level −1. Recent struggle → extra visual support (grouping, fewer choices, pictures back). Parents can set and lock levels. Full rules: [docs/adaptive-difficulty.md](docs/adaptive-difficulty.md).

## Progress storage

All state is one JSON object in `localStorage['jackapp:v1']`: per-skill progress, missions per area, recent sessions, settings, the parent PIN and the free-play line. It never leaves the device. Clearing the browser's site data resets the app. Corrupt or unknown data falls back to defaults.

## Parent mode

"För vuxna" (small link on the home screen) → `#/vuxen`.

- **Gate:** the first visit asks an adult arithmetic question and then a 4-digit PIN. After that it asks for the PIN. "Glömt koden?" re-runs the arithmetic check. The PIN is stored locally in plain text: it keeps a child out, not an attacker.
- **Dashboard:** missions per area; what is going well and what needs support; per-skill level, status, attempts and first-try share (marked "för lite data än" below 3 attempts); manual level + lock; recent sessions; collection progress. English is reported separately from Swedish reading.
- **Settings:** sound effects (off by default), read-aloud button, motion (system / reduced / full), free play on/off. There is also reset progress and change PIN.

## Audio

Optional and never automatic. A "Lyssna" button reads the prompt with the browser's Swedish voice (`speechSynthesis`, `sv-SE`). English tasks add "Hör på engelska" (`en-GB`). Buttons are hidden when speech is unsupported or turned off. Voice quality depends on the device: iOS, Android, Windows and macOS ship Swedish voices, while some Linux browsers do not. Every task is solvable without sound.

## Ljud och röster

Uppläsningen använder förgenererade Piper-klipp (svenska: Alma, engelska: Cori), sedan Piper i appen för ny text och till sist enhetens röst. `npm run speech` bygger klippen; se [docs/audio.md](docs/audio.md) för hur det funkar, hur man byter röst samt licenser och tack.
