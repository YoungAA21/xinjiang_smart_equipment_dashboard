# Repository Guidelines

## Project Structure & Module Organization

This is a Vue 3 equipment health dashboard built with Vite, Pinia, Vue Router, Element Plus, and ECharts. `src/main.js` boots the application; `src/App.vue` defines the application shell. Route pages live in `src/views/`, reusable UI in `src/components/`, and routing in `src/router/`. Keep HTTP access in `src/services/`, shared state in `src/stores/`, and chart option builders in `src/charts/`. Global styles live in `src/style.css`; feature styles live in `src/styles/`. Static assets belong in `public/`. Regression tests live in `tests/`; production output is generated in `dist/`.

## Build, Test, and Development Commands

Use Node 22.12+ on the 22 series or another version satisfying Vite's engine requirement. Node 20.18.1 is unsupported.

- `npm ci --include=optional`: install locked dependencies, including platform-specific Rolldown bindings.
- `npm run dev`: start the Vite development server with scoped API proxies.
- `npm run build`: create the production bundle in `dist/`.
- `npm run preview`: serve the built bundle locally.
- `node --experimental-vm-modules --test tests/*.test.mjs`: run the regression suite. There is no `npm test` script.

## Coding Style & Naming Conventions

Follow existing JavaScript ES module conventions: two-space indentation, single quotes, and no routine semicolons. Use Vue single-file components with `<script setup>` where appropriate. Name components and pages in PascalCase, such as `HealthDiagnostics.vue` and `TrendPage.vue`; use camelCase for functions, variables, and feature modules. Match nearby CSS conventions. No ESLint or Prettier configuration is currently provided.

## Testing Guidelines

Tests use `node:test`, strict assertions, mocked fetch responses, and VM modules for environment-dependent services. Name files `tests/<feature>.test.mjs`. Add focused regressions for changed behavior, especially authentication isolation, stale requests, polling cleanup, missing values, and chart transformations. Run the suite and production build before submitting. No numeric coverage threshold is configured; visually check affected pages and both themes for UI changes.

## Commit & Pull Request Guidelines

Recent commits use `fix`; no detailed commit convention is established. Prefer concise, descriptive imperative subjects. Pull requests should describe the behavior changed, link relevant issues when available, report validation commands and results, and include screenshots for visual changes.

## Configuration & API Boundaries

Copy `.env.example` to `.env.local` for local overrides. Never place secrets in `VITE_*` variables, which are exposed to the browser. Preserve the separation between collection services on port 5158 and authenticated acoustic services on port 18080; collection requests must not carry acoustic login tokens. Keep development proxy routes explicitly scoped and document endpoint changes in `README.md`.
