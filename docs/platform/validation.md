# Validation

Generated content is never trusted. Before an artifact is stored as usable, `server/validation` runs a pipeline of programmatic checks and returns a `ValidationReport`.

```ts
validateArtifact(artifact, { request, material?, db?, isValidRef?, aiReview? }): Promise<ValidationReport>
validateItem(item, { request, material?, school?, sourceMode?, db?, isValidRef?, aiReview? }): Promise<ValidationReport>
```

- `ok` is `false` when any issue has severity `error`. Warnings keep `ok: true` and are shown to adults.
- Each issue has a dotted `code`, a Swedish adult-facing `message`, and an `itemId` when it concerns one item.
- `checks` lists the checks that ran, in order.
- Every check is a pure function `(item | artifact, ctx) => ValidationIssue[]`, exported from `server/validation` (`ITEM_CHECKS`, `ARTIFACT_CHECKS`, and each check by name). Only `curriculum` and `aiReview` are async.
- If the contract parse fails, the pipeline stops there: the report has `checks: ['schema']` and one `schema.invalid` per zod issue.
- `validateItem` re-validates one regenerated item. It runs the item parse, every item check, `curriculum` and `aiReview`. The artifact-level schema checks (counts, duplicate ids, empty sections) are not run. The age band comes from `school`, or `request.school`, or defaults to `middle`. The source mode comes from `sourceMode`, or `request.sourceMode`.

## Checks

| Check        | Code                                | Severity   | Rule                                                                                                                                                                 |
| ------------ | ----------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`     | `schema.invalid`                    | error      | The `Artifact` / `Item` zod contract fails (pipeline stops).                                                                                                         |
|              | `schema.duplicate_item_id`          | error      | An item id is used more than once in the artifact.                                                                                                                   |
|              | `schema.empty_section`              | error      | A section has no items, no body and no media.                                                                                                                        |
|              | `schema.type_mismatch`              | error      | `artifact.type` differs from `request.type`.                                                                                                                         |
|              | `schema.item_count`                 | error/warn | The item total differs from `request.questionCount`. This is an error for `practiceTest` (±0) and a warning otherwise.                                               |
|              | `schema.unrequested_kind`           | warning    | The item kind is not in `request.itemKinds`.                                                                                                                         |
| `answers`    | `answers.unknown_answer`            | error      | An MC answer id, or a multi-select answer, is not among the choices.                                                                                                 |
|              | `answers.duplicate_choice_id`       | error      | Choice ids (MC, multi-select or ordering) are not unique.                                                                                                            |
|              | `answers.duplicate_choice_text`     | error      | Choice texts are not unique (case- and whitespace-insensitive).                                                                                                      |
|              | `answers.empty_choice`              | error      | A choice has neither text nor media.                                                                                                                                 |
|              | `answers.too_many_choices`          | error      | There are more choices than `request.support.maxChoices` (only when that is given).                                                                                  |
|              | `answers.empty_answers`             | error      | A multi-select item has no answers.                                                                                                                                  |
|              | `answers.duplicate_answer`          | error      | A multi-select answer is repeated.                                                                                                                                   |
|              | `answers.all_correct`               | warning    | Every multi-select choice is correct.                                                                                                                                |
|              | `answers.not_permutation`           | error      | The ordering answer is not a permutation of the item ids.                                                                                                            |
|              | `answers.duplicate_left` / `_right` | error      | A matching side repeats, which makes the pairing ambiguous.                                                                                                          |
|              | `answers.empty_pair`                | error      | A matching side is empty.                                                                                                                                            |
|              | `answers.blank_count`               | error      | The number of `___` in `text` differs from `blanks.length`.                                                                                                          |
|              | `answers.blank_empty`               | error      | A blank has an empty accepted value.                                                                                                                                 |
|              | `answers.missing`                   | error      | A true/false answer is not boolean, or a numeric answer is not finite.                                                                                               |
|              | `answers.empty_rubric`              | error      | A free-text rubric has only blank entries.                                                                                                                           |
|              | `answers.empty_back`                | error      | A flashcard has a blank back side.                                                                                                                                   |
| `math`       | `math.check_invalid`                | error      | `item.check` does not evaluate (syntax, an identifier, division by zero, etc.).                                                                                      |
|              | `math.answer_mismatch`              | error      | `answer` is not within `tolerance` of the value of `check`, or of the prompt expression when there is no `check`.                                                    |
|              | `math.check_mismatch`               | error      | `check` evaluates differently from the prompt's own expression (a "consistent but wrong" check).                                                                     |
|              | `math.unverified`                   | warning    | A numeric item has no `check` and its prompt is not a pure expression.                                                                                               |
|              | `math.mc_no_correct`                | error      | For MC with a pure-expression prompt and all-numeric choices, no choice equals the value.                                                                            |
|              | `math.mc_multiple_correct`          | error      | Under the same conditions, more than one choice equals the value.                                                                                                    |
|              | `math.mc_wrong_answer`              | error      | Under the same conditions, exactly one choice is right, but it is not the marked one.                                                                                |
|              | `math.unit_unknown`                 | warning    | `unit` is not in the known-unit table.                                                                                                                               |
|              | `math.unit_mismatch`                | warning    | `unit` does not match the dimension of any number+unit in the prompt. Area and volume accept lengths; `kr/kg` counts as both.                                        |
| `leakage`    | `leakage.answer_in_prompt`          | error/warn | The numeric prompt contains `= answer` (error). A flashcard has the same front and back (error). The MC/fill-blank/flashcard answer text is in the prompt (warning). |
|              | `leakage.hint_reveals_answer`       | error      | Hint 1 contains the answer: numeric answers when ≥10 or non-integer; text answers when non-trivial (≥4 chars, not just a number).                                    |
|              | `leakage.explanation_before_answer` | error      | The explanation (≥20 chars) is already in the prompt or a hint.                                                                                                      |
| `language`   | `language.unexpected_lang`          | error      | `item.lang`, or the confidently detected prompt language, is not allowed for the request (see below).                                                                |
|              | `language.mismatch`                 | warning    | The detected prompt language (sv/en) differs from `item.lang`.                                                                                                       |
| `age`        | `age.prompt_too_long`               | warn/error | The prompt (plus fill-blank text) is over the band × `textAmount` limit: a warning, or an error above twice the limit.                                               |
|              | `age.long_sentence`                 | warning    | Early band: a sentence has more than 12 words.                                                                                                                       |
|              | `age.difficult_words`               | warning    | Early band: the average word length is over 7 (with ≥4 words), or a word is longer than 16 letters.                                                                  |
| `safety`     | `safety.blocked`                    | error      | A denylisted violence/weapon term appears in an item or in the artifact title or sections.                                                                           |
|              | `safety.aviation_combat`            | error      | Borderline combat wording appears in text about aircraft.                                                                                                            |
|              | `safety.borderline`                 | warning    | A borderline term (war, soldier, blood, knife, ...) appears.                                                                                                         |
| `grounding`  | `grounding.no_upload_source`        | error      | Strict mode: the item has no `upload` SourceRef.                                                                                                                     |
|              | `grounding.material_missing`        | error/warn | Upload refs are cited but no `material` was passed. This is an error in strict mode and is reported once per artifact.                                               |
|              | `grounding.unknown_segment`         | error      | The `{ studySetId, page, segmentId }` is not in `material` (any mode: invented provenance).                                                                          |
|              | `grounding.excerpt_too_long`        | error      | The excerpt is over 300 chars.                                                                                                                                       |
|              | `grounding.excerpt_not_in_source`   | error      | The excerpt is not in the segment text (case/whitespace-insensitive; `…`/`...` may join fragments).                                                                  |
|              | `grounding.unsupported`             | error/warn | Lexical support fails (below). It is an error in `strict` and a warning in `sourceAndCurriculum` and `extended`.                                                     |
| `curriculum` | `curriculum.invalid_ref`            | error      | A `curriculumRefs` entry or `curriculum` SourceRef fails `isValidRef`.                                                                                               |
|              | `curriculum.unavailable`            | warning    | The validator threw (e.g. the DB is down).                                                                                                                           |
| `aiReview`   | `ai.possible_factual_error`         | warning    | The text model flags a likely factual error (opt-in).                                                                                                                |
|              | `ai.review_unavailable`             | warning    | The AI call failed.                                                                                                                                                  |

### Prompt length limits (characters)

| Band   | minimal | reduced | normal |
| ------ | ------: | ------: | -----: |
| early  |      60 |     110 |    160 |
| middle |     150 |     280 |    400 |
| upper  |     350 |     700 |   1000 |

The band comes from `ageBand(artifact.school)`, and `textAmount` from `request.support` (default `normal`). Long reading passages belong in a section `body`, not in item prompts.

### Language

- Detection is based on stopword counts (about 50 Swedish and 50 English words; å/ä/ö counts for Swedish). It answers only when one side has at least 2 hits and more than twice the other side's; otherwise it abstains.
- By default, only `sv` is allowed.
- `en` is also allowed for English subjects (`GRGRENG*`, `ENG*`, `ENL`, `KREI`, `RETR`) and when the topic or instructions mention English.
- The material's own language is allowed too.
- Foreign-language subjects (moderna språk, modersmål, Latin, ...) allow any language. Only the mismatch warning applies to them.

### Grounding: lexical support

- Key terms are normalized tokens of length ≥4 that are not stopwords, generic exercise words ("välj", "svar", "stämmer", ...) or numbers. They are then stemmed with naive Swedish/English suffix stripping.
- A term is supported when its stem is among the cited segments' stems (segment `text` plus `data`). Terms of length ≥5 are also supported when they are a substring of a segment stem, or the reverse, to handle Swedish compounds.
- An item is unsupported when more than half of the answer's key terms are missing, or when more than 60% of all key terms (answer plus prompt) are missing (with ≥2 terms).
- Distractors are ignored. True/false items use only the prompt.
- Numbers never count, so math worksheets ground on their wording, not their results.

### Curriculum

`isValidRef` is injected via `ctx.isValidRef`. When it is not given, it defaults to `server/curriculum/service.ts#isValidRef` with `ctx.db`. With neither, the check is skipped and does not appear in `checks`. Lookups are deduplicated per report.

### AI review (opt-in)

`ctx.aiReview = { text }` sends a compact list (id, kind, prompt, correct answer) to the text model with a structured `{ flags: [{ itemId, problem }] }` schema.

- Flags become **warnings only**. Flags for unknown item ids are dropped.
- The review never removes or downgrades a programmatic issue, and it never "approves".
- A failed call becomes `ai.review_unavailable`.

## Evaluator

`server/validation/expr.ts` is a recursive-descent parser. It has no `eval`/`Function`, and no identifiers except a whitelist of functions (checked with `Object.hasOwn`, so names like `constructor` are refused).

```
expr    := term (("+" | "-") term)*
term    := unary (("*" | "/") unary)*
unary   := ("+" | "-") unary | power
power   := postfix ("^" unary)?          right-associative: 2^3^2 = 512, -2^2 = -4
postfix := primary "%"*                  50% = 0.5
primary := number | "(" expr ")" | fn primary
fn      := "sqrt" | "abs" | "√"
number  := digits with "," or "." decimals, "1 000" thousands groups, ½ ¼ ¾ ⅓ ⅔ ⅕ ⅛ (2½ = 2.5)
```

- Operator aliases: `−` and `–` for minus, `×`, `·` and `⋅` for times, `÷` and `∕` for division, `**` for power. `²` and `³` mean `^2` and `^3`.
- Limits: 300 chars, 200 tokens and nesting depth 40.
- These are errors: division by zero, a non-finite or complex power (`(-8)^(1/3)`, `10^400`, `0^-1`), `sqrt` of a negative, any other character, and trailing tokens.
- Results are compared with `|a − b| ≤ tolerance + 1e-9·max(1,|a|,|b|)`.

`promptExpression(prompt)` accepts only prompts that are a pure arithmetic question:

- An optional lead-in is stripped ("Vad är", "Vad blir", "Hur mycket är", "Räkna ut", "Beräkna", "What is", "Calculate").
- So is a trailing `?`, `=`, `= ?` or `= ___`.
- `x` between numbers means times, and "av"/"of" after a number, `%` or `)` means times ("20 % av 50", "3/4 av 12").
- Anything with other letters (word problems) is left unverified.

## Safety

`server/validation/safety.ts` holds a small, deliberately conservative denylist. It matches lowercased text with letter boundaries, and Swedish compounds where noted.

- **Blocked (error).** Violence, weapons and combat:
  - döda (verb forms), kill/murder, mörda/mord, skjuta ner/ihjäl, shoot down
  - vapen/vapn- in compounds (e.g. kärnvapen), weapon(s), gevär/rifle/pistol/revolver/gun/ammunition
  - missil/missile, bomb, granat/grenade, sprängämne/explosive
  - massaker/massacre, tortyr/torture, terror\*, luftstrid/dogfight
- **Borderline (warning).** Legitimate in history, biology or everyday Swedish, but an adult should look at the wording:
  - krig/war, strid/combat/battle, soldat, armé, attack
  - fight/slåss, skjuta (also "skjuta upp"), blod, kniv
  - militär, döda (also "döda löv")
  - flygvapnet, vapensköld
- **Aircraft rule.** The learner's fighter-aircraft interest must stay about engineering and flight. When a text is about aircraft (flygplan, jaktplan, stridsflyg-, Gripen, JAS, jet, plane, aircraft, fighter), a borderline combat term in the same text becomes `safety.aviation_combat` (error). The exceptions are flygvapnet and vapensköld, which stay warnings.
- **Exceptions.** Known false positives are excluded explicitly: granatäpple, vapensköld, and flygvapnet (which is borderline instead).

Extend the lists in `safety.ts` with a test case for each new term. Prefer adding terms to borderline over blocked unless the term has no innocent school use.

## Integration

- **Generation.** Call `validateArtifact(artifact, { request, material, db })` after parsing the model output, and store the report on `artifact.validation`. To regenerate only failing items, group `issues` by `itemId`, then re-check each replacement with `validateItem(item, { request, material, school: artifact.school, sourceMode: artifact.sourceMode, db })`.
- **Messages.** Codes are stable and meant for logic (retry prompts can quote `message`). The messages are Swedish and safe to show adults.
- **Defaults.** `aiReview` is off by default. Enable it per request when a text capability is configured. Its warnings never block.
