# gormcsv-admin

A django-admin-style web UI for [gormcsv](https://github.com/edcrewe/gormcsv). It covers uploading
a CSV, generating its model, migrating the schema and populating the table, then browsing the
schema and records.

It is an Angular SSR app. The bundled Express server (`src/server.ts`) exposes a local `/api` that
runs the `gormcsv` CLI. See [PLAN.md](PLAN.md) for the phased roadmap and [AGENTS.md](AGENTS.md)
for coding conventions.

## Prerequisites

- Node.js 22+ and npm
- `gormcsv` on your `PATH`, or set `GORMCSV_BIN=/path/to/gormcsv`. It must have the `version`
  command, `--json` output and the `tables` command (gormcsv `90dffb7` or later). The workspace
  checkout needs `6678dfb` or later, which reads the import DSN from `GORMCSV_DSN`. Without `version` the header badge
  shows "gormcsv CLI not available or too old"; without `--json`, inspecting says gormcsv "may be
  too old".

```bash
npm install
```

### Model workspace

gormcsv can only import models compiled into its binary. Registering a CSV therefore regenerates
`importcsv/models.go` in a gormcsv source checkout and runs `go build`, so you also need Go 1.25+
and a C compiler. The admin overwrites `models.go` in that checkout, so give it its own detached
worktree rather than your working copy:

```bash
mkdir -p ~/.local/share/gormcsv-admin
git -C ~/projects/gormcsv worktree add --detach ~/.local/share/gormcsv-admin/gormcsv-src master
```

The workspace dir then holds:

- `gormcsv-src/`, the checkout
- `csv/`, the registered CSVs, one per model
- `bin/gormcsv`, the built binary
- `gormcsv.db`, the default SQLite database that **Populate tables** on the Models page imports
  into (see [Import database](#import-database))
- `duplicates.json`, each model's duplicate rule: when registering, choose whether a row already
  in the table is imported again, skipped when chosen key columns match (gormcsv `--key`), or
  skipped when the whole row matches (`--dedupe`). Change a rule only while the model's table is
  empty, because the unique index cannot be created over existing duplicates.

To move the checkout to a newer gormcsv, discard the generated file and re-register a model to
rebuild:

```bash
git -C ~/.local/share/gormcsv-admin/gormcsv-src checkout -- importcsv/models.go
git -C ~/.local/share/gormcsv-admin/gormcsv-src checkout --detach master
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

| Variable            | Default                          | Purpose                                              |
| ------------------- | -------------------------------- | ---------------------------------------------------- |
| `PORT`              | `4000`                           | Production server port                               |
| `HOST`              | `127.0.0.1`                      | Bind address. Kept local because the API runs a CLI. |
| `GORMCSV_BIN`       | `gormcsv`                        | Path to the gormcsv binary                           |
| `GORMCSV_WORKSPACE` | `~/.local/share/gormcsv-admin`   | Model workspace dir                                  |
| `GORMCSV_SRC`       | `$GORMCSV_WORKSPACE/gormcsv-src` | gormcsv checkout the admin builds                    |
| `GO_BIN`            | `go`                             | Go toolchain used for builds                         |
| `GORMCSV_DB_DRIVER` | `sqlite`                         | Import database: `sqlite`, `postgres` or `mysql`     |
| `GORMCSV_DSN`       | `$GORMCSV_WORKSPACE/gormcsv.db`  | Connection string; required for postgres and mysql   |

### Tables

The **Tables** page lists the import database's tables with their row counts. Choose one, or go
to `/tables/<name>`, to see its columns in table order with their database types, and its
indexes, including the unique ones a duplicate rule creates. It runs `gormcsv tables --json`, so
it works for SQLite, Postgres and MySQL alike.

### Import database

Imports go to the database set by `GORMCSV_DB_DRIVER` and `GORMCSV_DSN`, read once at startup;
a bad combination stops the server. The browser never sends or sees a DSN: the Models page and
the import summary show it with the password replaced by `***`. The DSN syntax is the GORM
driver's:

```bash
GORMCSV_DB_DRIVER=postgres GORMCSV_DSN='postgres://user:pass@localhost:5432/db?sslmode=disable'
GORMCSV_DB_DRIVER=postgres GORMCSV_DSN='host=localhost user=u password=p dbname=db sslmode=disable'
GORMCSV_DB_DRIVER=mysql GORMCSV_DSN='user:pass@tcp(localhost:3306)/db?parseTime=true'
```

URL-encode special characters in a URL-style password (`@` as `%40`). The admin hands the DSN
to gormcsv in its `GORMCSV_DSN` environment variable rather than as `--dsn`, so it does not show
in the process list. That needs a workspace binary built from gormcsv `6678dfb` or later; with an
older one, Populate refuses and asks you to re-register a model to rebuild it.

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

The integration tests need the same gormcsv as the app (`5d80040` or later). To test another
build:

```bash
GORMCSV_BIN=/path/to/gormcsv npm run test:server:it
```

The workspace integration test also needs `GORMCSV_SRC_REPO`. It builds gormcsv for real in a
temporary detached worktree of that repo, then imports with the result:

```bash
GORMCSV_SRC_REPO=~/projects/gormcsv npm run test:server:it
```

Set `GORMCSV_TEST_POSTGRES_DSN` as well to import into a real Postgres. A throwaway one in Docker:

```bash
docker run -d --name gormcsv-pg -e POSTGRES_USER=ed -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=admin \
  -p 55432:5432 postgres:15
GORMCSV_TEST_POSTGRES_DSN='postgres://ed:pw@localhost:55432/admin?sslmode=disable' \
  GORMCSV_SRC_REPO=~/projects/gormcsv npm run test:server:it
```

CI runs it against a Postgres service container.

`fixtures/` holds test data:

- `TestTypes.csv` and `Country.csv`, copied from gormcsv's `static/fixtures`. `Country.csv` has a
  deliberately short row on line 148, which `inspectcsv` skips with a warning, and a `model`
  column, which it renames to `ModelField`.
- `inspect-report.json` and `import-report.json`, real `--json` output for those two CSVs.
- `BadQuotes.csv`, an unbalanced quote, which `inspectcsv` still rejects (422).

Before committing:

```bash
npm test -- --watch=false && npm run test:server && npx prettier --check . && npm run build
```

CI (`.github/workflows/test.yml`) runs the same checks on every push and pull request. A second
job builds gormcsv master with `make build` and runs `npm run test:server:it` against it.

## Layout

```text
src/
  server.ts        Express server: /api router, static files, Angular SSR handler
  api/             API routers (health, inspect, models, import), the model workspace and
                   command runner, with *.test.ts beside them
  shared/          JSON types shared by the API and the Angular app
  app/             Angular app, with *.spec.ts beside components
    core/          App-wide services and components (CLI status)
    features/      One lazy-loaded page per route
    shared/        Reusable UI components (CodePanel, ModelFieldsTable)
  testing/         Spec helpers, such as expectNoAxeViolations
```

Component specs run AXE via `axe-core`. jsdom cannot compute styles, so colour contrast is not
checked there. Check it in a real browser.
