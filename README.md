# JackApp

A calm learning web app for a Swedish first grader who loves trains, metros, trams, airliners and fighter aircraft. Transport is not a reward after learning. It is the world the learning happens in.

UI language: Swedish. Data stays on the device. No accounts, no tracking, no AI calls.

## Run

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # static build in dist/ (works from any folder: hash routing + relative paths)
```

## Check

```bash
npm run check        # typecheck + lint + format check + unit tests
npm run test:e2e     # Playwright (tablet + phone) against a production build
```

First e2e run: `npx playwright install chromium`.

## Stack

Vite + React + TypeScript (strict), React Router (hash routing), plain CSS modules with design tokens, Vitest + Testing Library, Playwright, oxlint, Prettier. No backend. See [docs/architecture.md](docs/architecture.md).

## Docs

- [Writing learning content](docs/content-guide.md)
- [Adaptive difficulty](docs/adaptive-difficulty.md)
