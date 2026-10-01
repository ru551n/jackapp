# Architecture

```
src/
  core/        contracts (types.ts), skill catalog, seeded RNG, Swedish helpers
  engine/      adaptation rules + session planning (pure functions)
  content/     static content provider: generators per area + vehicle facts
  store/       app state persisted to localStorage (one key, versioned)
  art/         original SVG sprites and vehicle illustrations
  ui/          shared components: Shell, Button, SceneView, SpeakButton
  features/    screens: home, session, collection, parent, freeplay
  lib/         speech synthesis, sound
```

## Data flow

1. The child picks an area. `planSession()` chooses skills, and `nextQuestion()` asks a generator for a question at the skill's current level and support.
2. `Exercise` renders the `Question` (prompt, `Scene`, choice or order `Task`) and handles misses, hints and reveal.
3. On "Nästa", `actions.recordAnswer()` updates that skill's progress through `applyOutcome()`. The next question is generated _after_ this, so adaptation applies within a session.
4. On the last question, `actions.completeSession()` counts a mission for the area. Vehicle unlocks are a pure function of mission counts (`content/vehicles/index.ts`).

## Decisions

- **Stack:** Vite/React/TS. Fast tooling, typed contracts, easy component tests. No backend is needed for a local-first MVP.
- **Hash routing + `base: './'`:** the build runs from any static host or file path without server config.
- **Own tiny store** (`useSyncExternalStore` + localStorage) instead of a state library. The state is small and single-user.
- **Declarative `Scene`:** content describes _what_ to show and `SceneView` decides _how_. Content stays testable and UI-independent.
- **Generators as the content provider:** a future provider (curated packs, or AI-generated content) only has to produce `Generator`/`Question` objects that pass the same invariant tests.
- **Speech:** browser `speechSynthesis` with `sv-SE`, only on a "Lyssna" button press. It is hidden when unsupported or turned off by a parent. The app is fully usable without audio.
- **No red, no "fel":** wrong answers dim the tried option and show an amber "Prova igen" with a hint.

## Storage

Everything is in `localStorage['jackapp:v1']`: per-skill progress, missions per area, recent sessions, settings, the parent PIN and the free-play line. Nothing leaves the device. Clearing site data resets the app.
