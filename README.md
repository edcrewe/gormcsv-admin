# gormcsv-admin

A django-admin-style web UI for [gormcsv](https://github.com/edcrewe/gormcsv). It covers uploading
a CSV, generating its model, migrating the schema and populating the table, then browsing the
schema and records.

It is an Angular SSR app. The bundled Express server (`src/server.ts`) exposes a local `/api` that
runs the `gormcsv` CLI. See [PLAN.md](PLAN.md) for the phased roadmap and [AGENTS.md](AGENTS.md)
for coding conventions.

## Prerequisites

- Node.js 22+ and npm
- `gormcsv` on your `PATH` (master after v0.3.1), or set `GORMCSV_BIN=/path/to/gormcsv`.
  Without it, or with an older build, the UI loads but shows "gormcsv CLI not available or too old".

```bash
npm install
```

## Run the frontend

Development server with live reload, serving both the UI and `/api`:

```bash
npm start            # ng serve
```

Open <http://localhost:4200/>. The header badge shows the result of `GET /api/health`.

Production build and server:

```bash
npm run build                    # ng build -> dist/gormcsv-admin
npm run serve:ssr:gormcsv-admin  # http://127.0.0.1:4000
```

| Variable      | Default     | Purpose                                              |
| ------------- | ----------- | ---------------------------------------------------- |
| `PORT`        | `4000`      | Production server port                               |
| `HOST`        | `127.0.0.1` | Bind address. Kept local because the API runs a CLI. |
| `GORMCSV_BIN` | `gormcsv`   | Path to the gormcsv binary                           |

SSR only answers requests for `localhost` and `127.0.0.1` (`security.allowedHosts` in
`angular.json`). Add a host there if you serve it under another name.

## Run the tests

| Command                  | What it runs                                                           |
| ------------------------ | ---------------------------------------------------------------------- |
| `npm test`               | Angular component specs (`src/**/*.spec.ts`) with Vitest and jsdom     |
| `npm run test:server`    | Type-check, then Node API tests (`src/api/**/*.test.ts`) via supertest |
| `npm run test:server:it` | The API tests plus `*.it.test.ts`, which run the real `gormcsv` binary |

Run `npm test -- --watch=false` for a single pass instead of watch mode. API tests use a fake
`gormcsv` runner, so they don't need the binary installed. Integration tests are skipped unless
`GORMCSV_IT=1` is set, which `test:server:it` does.

The integration tests, and the admin's health check, need a `gormcsv` built from master after
v0.3.1. That build has the `version` command and skips ragged rows when inspecting. To test
another build:

```bash
GORMCSV_BIN=/path/to/gormcsv npm run test:server:it
```

`fixtures/` holds test data:

- `TestTypes.csv` and `Country.csv`, copied from gormcsv's `static/fixtures`. `Country.csv` has a
  deliberately short row on line 148, which `inspectcsv` skips with a warning.
- `BadQuotes.csv`, an unbalanced quote, which `inspectcsv` still rejects (422).
- `inspect-golden.models.go`, real `inspectcsv` output used to test the Go model parser.

Before committing:

```bash
npm test -- --watch=false && npm run test:server && npx prettier --check . && npm run build
```

## Layout

```text
src/
  server.ts        Express server: /api router, static files, Angular SSR handler
  api/             API routers (health, inspect) and the gormcsv runner, with *.test.ts beside them
  shared/          JSON types shared by the API and the Angular app
  app/             Angular app, with *.spec.ts beside components
    core/          App-wide services and components (CLI status)
    features/      One lazy-loaded page per route
    shared/        Reusable UI components (CodePanel)
  testing/         Spec helpers, such as expectNoAxeViolations
```

Component specs run AXE via `axe-core`. jsdom cannot compute styles, so colour contrast is not
checked there. Check it in a real browser.
