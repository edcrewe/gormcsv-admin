# gormcsv-admin

A django-admin-style web UI for [gormcsv](https://github.com/edcrewe/gormcsv). It covers uploading
a CSV, generating its model, migrating the schema and populating the table, then browsing the
schema and records.

It is an Angular SSR app. The bundled Express server (`src/server.ts`) exposes a local `/api` that
runs the `gormcsv` CLI. See [PLAN.md](PLAN.md) for the phased roadmap and [AGENTS.md](AGENTS.md)
for coding conventions.

## Prerequisites

- Node.js 22+ and npm
- `gormcsv` on your `PATH`, or set `GORMCSV_BIN=/path/to/gormcsv`. Without it the UI loads but
  shows "gormcsv CLI not available".

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

| Command               | What it runs                                                           |
| --------------------- | ---------------------------------------------------------------------- |
| `npm test`            | Angular component specs (`src/**/*.spec.ts`) with Vitest and jsdom     |
| `npm run test:server` | Type-check, then Node API tests (`src/api/**/*.test.ts`) via supertest |

Run `npm test -- --watch=false` for a single pass instead of watch mode. API tests use a fake
`gormcsv` runner, so they don't need the binary installed.

Before committing:

```bash
npm test -- --watch=false && npm run test:server && npx prettier --check . && npm run build
```

## Layout

```text
src/
  server.ts        Express server: /api router, static files, Angular SSR handler
  api/             API routers and the gormcsv runner, with *.test.ts beside them
  app/             Angular app, with *.spec.ts beside components
    core/          App-wide services and components (CLI status)
    features/      One lazy-loaded page per route
  testing/         Spec helpers, such as expectNoAxeViolations
```

Component specs run AXE via `axe-core`. jsdom cannot compute styles, so colour contrast is not
checked there. Check it in a real browser.
