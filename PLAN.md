# gormcsv-admin plan

A django-admin-style UI for [gormcsv](https://github.com/edcrewe/gormcsv), tuned to one workflow:
upload a CSV, generate its model, migrate the schema, populate the table, then browse the schema
and records.

The Angular SSR Express server (`src/server.ts`) is a local bridge to the `gormcsv` CLI. It is
also an Angular learning exercise, so features are added one step at a time. Each step is a
`feat:` commit then a `test:` commit, and stops for review before the next.

## Key constraint: models are compiled in

`gormcsv importcsv` only imports models compiled into its binary (`importcsv.MakeModels()` in a
generated `importcsv/models.go`). Importing a newly uploaded CSV therefore needs a rebuild, much
as Django needs a model in code before `migrate`:

1. Store the CSV in a workspace `csv/` dir.
2. Run `gormcsv inspectcsv -f workspace/csv -o $GORMCSV_SRC/importcsv/models.go`. This regenerates
   all models, because the file is overwritten.
3. Run `go build` in `GORMCSV_SRC` (a dedicated gormcsv checkout) to produce `workspace/bin/gormcsv`.
4. Run `importcsv` with that binary. It AutoMigrates each table, then batch-inserts the rows.

Requires Go on the host. Treat `models.go` as generated output: hand edits are lost.

## Conventions

Follow [AGENTS.md](AGENTS.md) for all Angular and TypeScript code. In particular:

- Standalone components (no `standalone: true`), default OnPush, lazy-loaded feature routes.
- Signals for state, `computed()` for derived state, `linkedSignal()` for synced state, never
  `mutate`.
- `inject()` not constructor injection. `@Service` for new root singletons.
- `input()`/`output()`/`model()`, not decorators. `host` object, not `@HostBinding`/`@HostListener`.
- Signal Forms (`@angular/forms/signals`) for new forms.
- Native control flow (`@if`/`@for`/`@switch`), `class`/`style` bindings, no `CommonModule`.
- Small single-purpose components, inline templates when small.
- Strict TypeScript, no `any` (use `unknown` and narrow).
- Must pass AXE checks and meet WCAG AA: focus management, contrast, ARIA.

Project-specific:

- UI: Angular Material + CDK (`mat-table`, paginator, sort, stepper, sidenav).
- API: Express routers in `src/api/`, built from factories that take injected dependencies
  (`createApiRouter({ runner })`), mounted on `/api` before the Angular SSR handler.
- Security: bind to `127.0.0.1` by default. The server owns DSNs (the browser never sends one).
  Sanitise uploaded filenames. Validate table and column names against the real schema before
  using them in SQL.
- Tests:
  - `*.spec.ts`: Angular specs, run with `npm test` (vitest + jsdom). Use `HttpTestingController`
    for HTTP.
  - `*.test.ts`: Node API tests, run with `npm run test:server` (tsc check, vitest, supertest with
    a fake runner). Real-CLI and real-build integration tests are opt-in via an environment
    variable.
  - `npx prettier --check` and `ng build` must pass before each commit.

## Phases

### Phase 0: Baseline fix (done)

- API router with an injectable, timeout-bounded `gormcsv` runner. JSON 404 for unknown `/api`
  paths.
- Health check (`gormcsv --help`) runs in the browser only via `afterNextRender`, so build-time
  prerender doesn't call `/api`.
- SSR `allowedHosts` for localhost. Lockfile tracked. Prettier config restored.
- Split test harness for specs and server tests.

### Phase 1: Admin shell

- Material sidenav and toolbar layout.
- Lazy routes: `/import`, `/models`, `/tables`, `/history`.
- `CliStatusService` (signals) replaces the health logic in `App`.

### Phase 2: Upload and inspect

- `POST /api/inspect` (multer in-memory storage, `.csv` only, size limit, per-request temp dir
  removed afterwards). Returns the generated Go model.
- Upload component with a copyable model preview.

### Phase 3: Model workspace

- Register a model: store the CSV, regenerate `models.go`, build the workspace binary.
- Builds are serialised and timeout-bounded, and build errors are shown in the UI.
- A models list shows what the current binary can import.

### Phase 4: Migrate and populate

- `POST /api/import` runs the workspace binary.
- Parse the `<model>: inserted N, skipped N duplicates, rejected N` lines into JSON. A non-zero
  exit returns the partial results with the error.
- Signal Forms for batch size and workers. Material results table.

### Phase 5: Connection config

- Server-side driver and DSN from environment variables, SQLite first.
- Shown read-only in the UI.

### Phase 6: Schema browser

- `GET /api/tables` and `GET /api/tables/:name/schema` (better-sqlite3).
- Sidebar table list and column/type detail view at `/tables/:name`.

### Phase 7: Record browser

- Paginated, sortable rows in `mat-table` with paginator and sort.
- Identifiers validated against the schema. Includes injection tests.

### Phase 8: Import history

- Audit log in a metadata SQLite file: time, file, model, counts, exit status.
- History view, like django-csvimport's log.

### Later

- Schema editor to override inferred types before generating models.
- Postgres/MySQL browsing.
- ESLint and GitHub Actions CI.
- `npx gormcsv-admin` bin entry.
- `samples/` with example CSVs.
- README and screenshots.
