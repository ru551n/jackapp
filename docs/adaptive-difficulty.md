# Adaptive difficulty

Deterministic and local. There is no AI and no global level. Each skill has its own level, 1–5.
Code: `src/engine/adaptation.ts` and `src/engine/session.ts`.

## Per answer

Each answer is classified by how many tries it took:

| Outcome  | Meaning                                                |
| -------- | ------------------------------------------------------ |
| `first`  | correct on the first try                               |
| `retry`  | correct after one miss                                 |
| `helped` | needed two or more tries, so stronger hints were shown |

The last 6 outcomes are kept per skill. Then:

- **Level up (+1)** after 4 `first` answers in a row in that skill.
- **Level down (−1)** when 2 of the last 3 answers were `helped`.
- After a level change the recent window is cleared, so changes are never back-to-back.
- **Extra support** for the next question when the last answer was `helped`, or when 2 of the last 3 needed retries. Generators then show more visual support (grouping, fewer choices).
- A parent can set a level manually and lock it. A locked skill does not change automatically.

## Per session ("uppdrag")

A mission is 4 questions. The engine picks the two least recently practised skills in the area (never-practised ones first) and asks two questions from each. Every skill gets practised over time, in a predictable way.

Questions are generated from a seed (`sessionCounter`, question index). Recently seen question ids (the last 40) are avoided by re-rolling.

## Parent view

`trendOf()` turns the recent window into a status:

- _ny_: no answers yet
- _går lätt_: at least 75% first-try answers
- _svårt just nu_: at least a third of recent answers were `helped`
- _på gång_: everything else
