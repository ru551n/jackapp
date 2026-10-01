# Writing learning content

All learning content is **data produced by generators**. UI components never contain exercise logic.

## The pieces

| Piece            | Where                                           | What                                                            |
| ---------------- | ----------------------------------------------- | --------------------------------------------------------------- |
| Skills and areas | `src/core/catalog.ts`                           | Which skills exist and which area each belongs to               |
| Contracts        | `src/core/types.ts`                             | `Question`, `Scene`, `Task`, `Hint`, `Generator`, `Vehicle`     |
| Generators       | `src/content/<area>/*.ts`                       | One file per activity type, registered in the area's `index.ts` |
| Vehicle facts    | `src/content/vehicles/{rail,aircraft}.ts`       | Verified facts reused by collection and exercises               |
| Vehicle art      | `src/art/vehicles/`                             | Original SVG illustrations keyed by vehicle id                  |
| Helpers          | `src/content/helpers.ts`, `src/core/swedish.ts` | Distractor choices, Swedish number words, colour names          |

## A generator

```ts
export const countMetroCars: Generator = {
  id: 'math.count.metroCars', // unique, prefixed by skill
  skill: 'math.count',
  levels: [1, 5], // inclusive levels this activity suits
  generate({ rng, level, support }) {
    // rng is seeded: never use Math.random()
    return { id, skill, level, theme, prompt, scene, task, hints, success }
  },
}
```

Rules (enforced by `src/content/content.test.ts` for every generator):

- **Deterministic**: only use `rng`. Same seed → same question.
- `Question.id` starts with the skill and encodes the _content_ (not the seed), e.g. `math.add.carriages:3+2`, so the engine can avoid repeats.
- 2–6 options, unique ids, the answer is among them. Picture-only choices need an `ariaLabel`.
- At least one hint. Hints escalate: `hints[0]` after the first miss, `hints[1]` after the second. A hint may swap in a more supportive `scene` or `eliminate` wrong choices (never the answer, and leave at least 2 options).
- `support === 'extra'` means the child struggled recently: show stronger visual support up front (grouping, fewer choices, pictures alongside numbers).
- After 3 misses the UI gently reveals the answer. Nothing is ever marked "fel".

## Tone

- Swedish, short sentences, words a first grader can read or have read aloud (`speech` overrides the spoken text, e.g. to say "tre plus ett" for `3 + 1`).
- Transport is the medium: carriages, passengers, platforms, gates, aircraft, not generic objects.
- `success` is one calm sentence that restates the result ("Ja! Tåget har fem vagnar.").
- Aircraft are vehicles and engineering: names, shapes, countries, engines, size, eras. No weapons or combat.

## Levels (guideline)

| Level | Reading                                                              | Mathematics (add/sub total)                                |
| ----- | -------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1     | short picture-backed words (TÅG, BIL), 2 choices, two-word sentences | ≤ 5, pictures only                                         |
| 2     | short familiar words, uppercase                                      | ≤ 6, pictures + a number under each group                  |
| 3     | longer words, missing letter, mixed case                             | ≤ 8, pictures + `3 + 2 = ?`                                |
| 4     | short sentences                                                      | ≤ 10, equation first with pictures below                   |
| 5     | two-sentence comprehension                                           | ≤ 12, equation with a count-on aid (never a bare equation) |

`support === 'extra'` brings full pictures back at the **same** numeric range. Choice counts come from the shared `choiceCount()` (2 at level 1 or with extra support, 3 at levels 2–3, 4 above).

## Hints

With 2 choices a child can only miss once, so `hints[0]` must be the real scaffold: a supportive scene, a counting cue, or the word sign. `hints[1]` is a worked step. Only eliminate options when at least 2 remain, and never write "vi tar bort…" when nothing is removed.

## Languages

English content sets `promptLang: 'en'` for English prompts, `lang: 'en'` on English choices and signs, and `Hint.speech` (Swedish only) whenever a hint's text contains English, so the Swedish voice never reads English words.
