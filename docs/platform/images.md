# AI-generated images (`server/images`)

JackApp can draw calm, themed illustrations with the `IMAGE` capability ([ai-providers.md](ai-providers.md)). They decorate and support material. They are **never** the source of truth for a fact or an answer.

## AI illustration or licensed image?

| Need                                                                                                                                                       | Use                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Mood, decoration, story scenes, themed practice (a happy dinosaur, trains to count, a simple diagram of a process)                                         | AI illustration (`image.generate`)                                 |
| Anything a learner must **recognise as real**: a real aircraft or train model, an archaeological find, a map, a flag, a real person, a species to identify | Licensed image (research: `findLicensedImages`), never an AI image |

The rule is enforced before any provider call. `needsRealImagery(description, subject)` is a deterministic heuristic. It returns true when the description contains any of these:

- a map word (`karta`, also in compounds such as `Europakarta`, plus `atlas` and `map`)
- a flag word (`flagga`, `Sverigeflagga`, `flag`)
- "real" or identification wording (`riktig`, `verklig`, `äkta`, `autentisk`, `känna igen`, `identifiera`, `artbestämning`)
- a vehicle make or named model that children ask for (`Saab`, `Boeing`, `Viggen`, `Gripen`, `X2000`, …)
- a model designation: a capitalised word followed by digits (`Saab 37`, `Boeing 747`) or a short code (`A320`, `Rc6`)
- a proper noun, meaning a capitalised word after the first word of a sentence (`vikingasvärd från Birka`, named people, brands and characters)
- in a history, geography, social-studies or biology subject: an artifact or specimen word (`svärd`, `runsten`, `fynd`, `fossil`, …)
- in biology or NO: a species or anatomy word (`blåmes`, `älg`, `svamp`, `hjärtat`, `lungor`, `skelett`, …); children learn to recognise these, so they must be real photos or drawings
- photo wording (`foto`, `fotografi`, `fotorealistisk`, `photo`): a photo is real imagery, so it is searched for, not generated

The heuristic errs towards true. A false positive only means that a licensed image is searched for instead. When it returns true, the job and the API refuse with code `factual_reference`.

## Prompt rules (`buildImagePrompt`)

Prompts are written in English, because image models follow English best. The scene description stays in Swedish.

- Every image is a calm, uncluttered educational illustration.
- **Age band** (from the learner's school position):
  - `early`: picture-book style, simple rounded shapes, soft colours, one focal point
  - `middle`: clear, friendly flat illustration
  - `upper`: clean, diagram-like style on a white background
- The `diagram` purpose leaves space for labels.
- The **special-interest theme** (from the payload, otherwise the learner's first theme or interest) is used where it fits.
- **No text** in the image unless `allowText` is set. Models garble letters, so the UI renders labels.
- **Safety clauses** are always added: no violence, weapons, blood, injuries, danger or scary content; not photorealistic; no real or recognisable people, and never a realistic child.
- **Counting** (`purpose: 'counting'`, `count: N`): the prompt demands exactly N clearly separated, fully visible objects and no other countable objects.

> **Counts are not guaranteed.** Image models regularly draw the wrong number of objects. A counting task's answer must come from the item data (`answer`), never from the image, and the UI must work without the image.

## Safety

- Descriptions containing violence, weapons or scary content are refused with `unsafe_content` (checked first). Photo wording is routed to the licensed search instead (above). Words with common innocent uses (`döda` as in Döda havet, `lik` as in likadan) are not on the list.
- Factual reference imagery is refused with `factual_reference` (see above).
- Generated assets are stored with `generated: true` and the licence `{ license: 'ai-generated', provider: <AI_IMAGE_PROVIDER kind>, creator: 'AI (<model>)', autoUsable: true }`. The alt text is Swedish: `AI-genererad bild: <beskrivning>`. The UI should label AI images.

## Limits and availability

- `FEATURE_IMAGE_GENERATION=false` turns the feature off. The job fails with `feature_disabled` and the API returns 409.
- If no `AI_IMAGE_PROVIDER` is configured, the code is `capability_missing` (409).
- `LIMIT_IMAGES_PER_DAY` (default 300) caps generated images per calendar day (database clock). The count lives in `image_generation_days` and is reserved atomically before the provider call. A slot is kept even if the provider then fails.
  - Over the cap, the job fails with `limit_exceeded` (not retried) and the API returns 429.
- All of these failures are non-retryable `JobError`s with Swedish adult messages. Provider errors (`ai_*`) keep their retryability.

### Without image generation ("Mer bildstöd" fallback)

When no `AI_IMAGE_PROVIDER` is configured (or `FEATURE_IMAGE_GENERATION=false`), "Mer bildstöd" and "Bilder" still add pictures: illustration requests with a search term (`imageQuery`, and per-choice terms for early learners) become `asset.fetch` jobs against Wikimedia Commons and Openverse. Only CC0/PD/CC BY/CC BY-SA images classified `autoUsable` are stored, with their attribution, and the UI shows licence and source as for any licensed image. See [generation.md](generation.md#illustrations).

`FEATURE_EXTERNAL_ASSETS` defaults to **true**: the images are openly licensed and attributed, are fetched through the SSRF-safe fetcher (`server/research/fetch.ts`, size- and type-limited, magic-byte sniffed, no SVG), and need no API key. Set it to `false` to keep the server from contacting Commons/Openverse. If neither image generation nor licensed search is available, the adult sees "Bilder kräver bildgenerering eller bildsökning – se Systemstatus" where pictures are chosen, and no image jobs are enqueued.

## API

| Route                              | Who   | Result                                                                                                                                                         |
| ---------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/learners/:id/images` | adult | Body `{ description, purpose?, subject?, count?, allowText?, theme?, artifactId?, target? }` → `202 { jobId }`. Follow the job; its `resultId` is the asset id |
| `GET /api/v1/images/limits`        | adult | `{ enabled, today, cap, remaining, reason?, label }`; `label` is Swedish status text                                                                           |
| `GET /api/v1/assets/:id`           | any   | The image bytes                                                                                                                                                |

## Artifact integration

- `illustrationJobsFor(slots, { enqueue, style, subject?, learnerId? })` enqueues one `image.generate` job per slot, deduped per `artifactId` and path. It returns `{ slot, jobId }`, or `{ slot, refused: 'factual_reference' }` for slots that should go to licensed search.
- `applyGeneratedMedia(artifact, [{ path, media }])` is pure. It returns a new artifact with each `MediaRef` inserted at its path:
  - `sections.N` and `sections.N.items.M` append, up to 6 and 4 media
  - `sections.N.items.M.choices.K` (or `.items.K` for ordering items) sets the media
  - Missing paths, full slots and duplicate assets are skipped.
- Slots carry an optional `itemId` (`target: { path, itemId }`), so a finished image still finds its item after edits. Generation enqueues the slots and applies finished jobs as new versions through the worker's completion hook: see [generation.md](generation.md#illustrations).
