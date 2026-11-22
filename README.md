# gormcsv-admin

A relational database admin UI for [gormcsv](https://github.com/edcrewe/gormcsv). It covers uploading
a CSV, generating its model, migrating the schema and populating the table, then browsing the
schema and records.

It is an Angular SSR app. The bundled Express server (`src/server.ts`) exposes a local `/api` that
runs the `gormcsv` CLI. See [PLAN.md](PLAN.md) for the phased roadmap, [HISTORY.md](HISTORY.md)
for changes in each release, and [AGENTS.md](AGENTS.md) for coding conventions.

If developing a Go application with the gorm ORM this and gormcsv can be used to ingest unknown format
CSV files turning them into database tables of data, the generated gorm models file can be updated to the main application.

Or it can be used standalone as a means to regularly ingest large variant format data in basic CSV format into a database such as Postgres for structured data engineering work. The Go parallel ingestion feature of gormcsv enables low footprint performant parallel ingestion of large amounts of data.
This admin UI serves the purpose of model (schema) creation and inspection in models.go
Testing with sample data inspection and tweaking ready for using for large scale ingestion.

## Prerequisites

- Node.js 22+ and npm
- `gormcsv` on your `PATH`, or set `GORMCSV_BIN=/path/to/gormcsv`. It must have the `version`
  command, `--json` output and the `tables` and `rows` commands (gormcsv `v0.4.0` or later).
  The workspace reads the import DSN from `GORMCSV_DSN`. Without `version` the header badge
  shows "gormcsv CLI not available or too old"; without `--json`, inspecting says gormcsv "may be
  too old".

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

Its **Rows** tab pages through the table, sorted by the primary key until you click a column
header. The page, page size and sort are kept in the URL (`?view=rows&page=2&size=50&sort=name`),
so a view can be bookmarked or shared, and Back steps through earlier pages. Paging and sorting
run in the database through `gormcsv rows`, which checks the table and column names against the
database's own catalogue.

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
in the process list. That needs a workspace binary built from gormcsv `v0.4.0` or later; with an
older one, Populate refuses and asks you to re-register a model to rebuild it.

Or, to run it as a command from anywhere, link the package once after building:

```bash
npm run build && npm link
gormcsv-admin --port 4000 --host 127.0.0.1   # or: npx gormcsv-admin
```

`gormcsv-admin` starts the built server with the same environment variables. Rebuild after
pulling changes; `npm unlink -g gormcsv-admin` removes the command.

Without building it yourself, download `gormcsv-admin-<tag>.tar.gz` from a GitHub release. The
server bundle includes its dependencies, so it needs only Node.js 22+ (plus gormcsv, as above):

```bash
tar -xzf gormcsv-admin-v0.2.0.tar.gz
node gormcsv-admin-v0.2.0/bin/gormcsv-admin.mjs --port 4000
```

gormcsv itself installs with `go install github.com/edcrewe/gormcsv@v0.4.0`, or from its own
releases.

Each release also has `sbom.spdx.json`, an SPDX software bill of materials for the production
dependencies in `package-lock.json`. Pushing a `v*` tag builds, tests and publishes the release
(`.github/workflows/release.yml`).

SSR only answers requests for `localhost` and `127.0.0.1` (`security.allowedHosts` in
`angular.json`). Add a host there if you serve it under another name.

### Model workspace

gormcsv can only import models compiled into its binary. Registering a CSV therefore regenerates
`importcsv/models.go` in a gormcsv source checkout and runs `go build`, so you also need Go 1.25+
and a C compiler. The admin overwrites `models.go` in that checkout, so give it its own detached
worktree rather than your working copy, at gormcsv `v0.4.0` or a later release tag:

```bash
mkdir -p ~/.local/share/gormcsv-admin
git -C ~/projects/gormcsv worktree add --detach ~/.local/share/gormcsv-admin/gormcsv-src v0.4.0
```

The workspace dir then holds:

- `gormcsv-src/`, the checkout
- `csv/`, the registered CSVs, one per model
- `bin/gormcsv`, the built binary
- `gormcsv.db`, the default SQLite database that **Populate tables** on the Models page imports
  into (see [Import database](#import-database))
- `history.jsonl`, the import history: one line per registration and import, shown on the
  **History** page
- `duplicates.json`, each model's duplicate rule: when registering, choose whether a row already
  in the table is imported again, skipped when chosen key columns match (gormcsv `--key`), or
  skipped when the whole row matches (`--dedupe`). Change a rule only while the model's table is
  empty, because the unique index cannot be created over existing duplicates.

To move the checkout to a newer gormcsv, discard the generated file, check out the new tag (here
`v0.4.0`) and re-register a model to rebuild:

```bash
git -C ~/.local/share/gormcsv-admin/gormcsv-src checkout -- importcsv/models.go
git -C ~/.local/share/gormcsv-admin/gormcsv-src checkout --detach v0.4.0
```

## Try it with the samples

`samples/` has three small CSVs, each showing a different way to handle rows that are already in
the table:

| CSV               | Register with                                      | Shows                                       |
| ----------------- | -------------------------------------------------- | ------------------------------------------- |
| `products.csv`    | Skip when key columns match: `sku`                 | A natural key, decimals, booleans and dates |
| `order-lines.csv` | Skip when key columns match: `order_id` and `line` | A composite key                             |
| `readings.csv`    | Skip when the whole row matches                    | No natural key; one reading is repeated     |

1. On **Import CSV**, choose a sample and **Inspect** it to see the model gormcsv infers.

   ![Inspecting products.csv](docs/screenshots/import.png)

2. Pick its duplicate rule as in the table above, and **Register** it, which rebuilds gormcsv
   with the new model. Repeat for the other samples.

   ![Registering products.csv with a key on sku](docs/screenshots/register.png)

3. On **Models**, **Import** all registered CSVs: 17 rows go in, and the repeated reading is
   skipped. Import again and all 18 rows are skipped.

   ![A second import skipping every row](docs/screenshots/populate.png)

4. **Tables** shows the new tables with their columns and indexes, and the **Rows** tab pages
   and sorts their contents.

   ![The products table's columns](docs/screenshots/tables.png)

   ![Products sorted by price, most expensive first](docs/screenshots/rows.png)

5. **History** shows each step.

   ![The import history](docs/screenshots/history.png)

## Run the tests

| Command                  | What it runs                                                           |
| ------------------------ | ---------------------------------------------------------------------- |
| `npm test`               | Angular component specs (`src/**/*.spec.ts`) with Vitest and jsdom     |
| `npm run lint`           | ESLint (angular-eslint), including template accessibility rules        |
| `npm run test:server`    | Type-check, then Node API tests (`src/api/**/*.test.ts`) via supertest |
| `npm run test:server:it` | The API tests plus `*.it.test.ts`, which run the real `gormcsv` binary |

Run `npm test -- --watch=false` for a single pass instead of watch mode. API tests use a fake
`gormcsv` runner, so they don't need the binary installed. Integration tests are skipped unless
`GORMCSV_IT=1` is set, which `test:server:it` does.

The integration tests need the same gormcsv as the app (`v0.4.0` or later). To test another
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
npm run lint && npm test -- --watch=false && npm run test:server && npx prettier --check . && \
  npm run build
```

CI (`.github/workflows/test.yml`) runs the same checks on every push and pull request. A second
job builds gormcsv `v0.4.0`, the oldest release the admin supports, with `make build` and runs
`npm run test:server:it` against it.

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

Component specs run AXE via `axe-core` to check accessibility.
