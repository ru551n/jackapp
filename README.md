# JackApp

A calm, self-hosted Swedish learning platform for a household's children, from förskoleklass to gymnasium. An adult describes what a child needs ("multiplikation åk 4", a photographed worksheet, an interest like trains); JackApp uses AI to create exercises tied to Skolverket's curriculum, checks them, and lets the adult approve them before the child practises. The original transport-themed app for a first grader (below) is part of it.

- **Self-hosted:** runs on your own server with Docker Compose (Postgres, app, worker). Data stays in your database and volumes.
- **AI is required:** text generation needs an AI provider, either a cloud API (OpenAI, Anthropic) or a model on your LAN (llama.cpp, vLLM, Ollama…). `ALLOW_CLOUD_AI=false` keeps everything on your network. See [AI providers](docs/platform/ai-providers.md).
- **No login:** whoever reaches JackApp is trusted. Put it behind a reverse proxy that controls access (Caddy + Authentik example). An adult PIN keeps children out of the adult area.
- **Language:** the UI is Swedish. English is taught as a subject.

## Run (Docker)

```bash
cp .env.example .env     # fill in PUBLIC_URL, APP_SECRET, POSTGRES_PASSWORD and one AI_TEXT_* block
docker compose up -d --build --wait
curl -s http://127.0.0.1:3000/ready
```

Then point the reverse proxy at `127.0.0.1:3000`. Details: [deployment](docs/platform/deployment.md) (topology, backups and restore, upgrades), [reverse proxy](docs/platform/reverse-proxy.md), [troubleshooting](docs/platform/troubleshooting.md).

## Documentation

- [Architecture](docs/platform/architecture.md), [environment variables](docs/platform/env.md), [decisions](docs/platform/decisions.md)
- [Curriculum](docs/platform/curriculum.md), [generation](docs/platform/generation.md), [validation](docs/platform/validation.md), [adaptive difficulty](docs/platform/adaptive.md)
- [Study material uploads](docs/platform/uploads.md), [images](docs/platform/images.md), [web research and licensing](docs/platform/research-and-licensing.md)
- [Frontend](docs/platform/frontend.md), [learners](docs/platform/learners.md), [runs](docs/platform/runs.md), [jobs](docs/platform/jobs.md), [audio](docs/audio.md)

## Develop

```bash
npm install
npm run dev:all      # app + worker with an in-process database; web dev server: npm run dev
npm run check        # typecheck + oxlint + prettier --check + vitest
npm run test:e2e     # Playwright on a production build (tablet 1024×768 and phone profiles)
```

Server scripts: `dev:server`, `dev:worker`, `build:server`, `start`, `start:worker`, `db:generate`, `db:migrate`. First e2e run: `npx playwright install chromium`. CI (`.github/workflows/ci.yml`) runs both.

## Licence and credits

JackApp is MIT-licensed ([LICENSE](LICENSE)). The web app also ships third-party components, including **espeak-ng (GPL-3.0)** inside the in-browser speech engine; see `public/THIRD_PARTY_NOTICES.txt` (served as `/THIRD_PARTY_NOTICES.txt`), [docs/audio.md](docs/audio.md#credits-and-licences) for what that means when you redistribute a build, and the "Om appen" page in the adult area. Swedish voice: Alma by Daniel Nylander, CC BY 4.0. Curriculum: Skolverket, CC0.

## The transport learning app

The original app: a calm learning web app for a Swedish first grader who loves trains, metros, trams, airliners and fighter aircraft. Transport is not a reward after learning. It is the world the learning happens in. It runs entirely in the browser (designed for an autistic child in a special-education class; usable independently) and is now the early-band learner experience of the platform. It still builds as a static site:

```bash
npm run build        # static site in dist/ (hash routing + relative paths: host anywhere, even a subfolder)
npm run preview      # serve the production build
```

### What's in it

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

### Architecture

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

#### Where content lives

- **Learning activities:** `src/content/{reading,math,logic,aviation,english}/`. Each file exports `Generator`s that produce `Question` data (prompt, `Scene`, task, hints). See [docs/content-guide.md](docs/content-guide.md).
- **Transport and aircraft facts:** `src/content/vehicles/rail.ts` and `aircraft.ts`, with verified specs and `sources`. They are reused by the collection, recognition, reading, comparison and English activities.
- **Illustrations:** `src/art/sprites.tsx` (generic sprites), `src/art/vehicles/{rail,aircraft}.tsx` (per-vehicle art). All original vector drawings; no third-party images.
- **English vocabulary:** `src/content/english/vocab.ts`.

#### Adding content

1. Write a `Generator` in the right area folder and add it to that folder's `index.ts`.
2. Run `npm test`. `src/content/content.test.ts` automatically checks every generator: deterministic, the answer is present, hints never remove the answer, picture choices have accessible names, every skill starts at level 1.
3. New vehicle: add it to `rail.ts`/`aircraft.ts` with `sources` and an `unlock` rule, then add its art to the matching art registry.

A future content source (curated packs, or generated content) only needs to produce `Generator`/`Question` objects that pass the same tests. The engine and UI stay unchanged.

### Adaptive difficulty

Each skill (e.g. `math.add`, `read.sentences`, `en.colors`) has its own level 1–5. There is no global level. Four first-try answers in a row → level +1. Two of the last three needing strong help → level −1. Recent struggle → extra visual support (grouping, fewer choices, pictures back). Parents can set and lock levels. Full rules: [docs/adaptive-difficulty.md](docs/adaptive-difficulty.md).

### Progress storage

In this part of the app, progress is one JSON object per learner in `localStorage['jackapp:v1:<learnerId>']`: per-skill progress, missions per area, recent sessions, settings and the free-play line. The old global `jackapp:v1` key is offered for import into a learner on first use (see [frontend.md](docs/platform/frontend.md)). Corrupt or unknown data falls back to defaults.

### Parent mode

Replaced by the platform's adult area (`#/vuxen`, behind the household PIN): learners, generated material for approval, progress, study material and the "Om appen" credits page. See [frontend.md](docs/platform/frontend.md) and [gate.md](docs/platform/gate.md).

### Audio

Optional and never automatic. A "Lyssna" button reads the prompt aloud; English tasks add "Hör på engelska". Speech is tried in this order: pre-generated Piper clips (Swedish: Alma, English: Cori), Piper running in the browser for new text, then the device's own voice. Every task is solvable without sound. `npm run speech` builds the clips; [docs/audio.md](docs/audio.md) explains how it works, how to change a voice, and the licences and credits.
