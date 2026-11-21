# gormcsv-admin plan

A django-admin-style UI for [gormcsv](https://github.com/edcrewe/gormcsv), tuned to one workflow:
upload a CSV, generate its model, migrate the schema, populate the table, then browse the schema
and records.

The Angular SSR Express server (`src/server.ts`) is a local bridge to the `gormcsv` CLI. It is
also an Angular learning exercise, so features are added one step at a time. Each step is a
`feat:` commit then a `test:` commit, and stops for review before the next.

## Status (2026-11-21)

Phases 0 to 8 are done: 119 Angular specs and 214 API tests pass (225 including the real-CLI,
real-build and real-Postgres integration tests).

**Open gormcsv branch `rows-command` (`e44e9ff`)**: the Rows tab needs it. Merge it before
pushing the admin; CI builds gormcsv master.

**Remaining "Later" item, in progress:** README screenshots. The schema editor is deferred.

Notes for picking up:

- gormcsv master (merged and pushed) now has ragged-row skipping in `inspectcsv` and a `version`
  command. The admin's health check and integration tests rely on both. Commit further gormcsv
  fixes found during this work in `~/projects/gormcsv`, checking the branch first.
- Initial bundle is about 503 kB. The warning budget was raised to 600 kB (error still 1 MB)
  because the shared Material and Angular resource code now loads with `main`.
- Workspace: a detached worktree at `~/.local/share/gormcsv-admin/gormcsv-src`, with `csv/`,
  `bin/` and `duplicates.json` beside it. The models the binary was built with are saved as
  `bin/models.json`, so the Models page stays right even if the worktree is updated.
- The local workspace worktree is at gormcsv `6678dfb`. It holds only fixture data from manual
  checks: Country (key on `code`) and TestTypes registered, and `gormcsv.db` with `countries`
  (245 rows) and `test_types` (6 rows). Automated tests use temp dirs and never touch it.
  Country's `some … model` columns are a deliberate fixture header ("some other data that we dont
  have in our model"), not test leakage. Ed may want it reset: remove `csv/`, `bin/`,
  `duplicates.json` and `gormcsv.db`, then run
  `git -C ~/.local/share/gormcsv-admin/gormcsv-src checkout -- importcsv/models.go`.
- Start admin servers as `VAR=x node dist/gormcsv-admin/server/server.mjs &` so `$!` is node's
  PID; `nohup env … node` gave a wrapper PID and left stale servers on port 4123.
- VS Code: if test globals go missing, run "TypeScript: Restart TS Server". All three tsconfigs
  are referenced from `tsconfig.json`.
- Stop a background server by PID, not `pkill -f`, which can match the calling shell.
- `run_oc.sh` is the user's file and is untracked. Leave it alone.

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
- Lint: `npm run lint` (angular-eslint, with template accessibility rules) runs in CI.
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

### Phase 1: Admin shell (done)

- Material sidenav and toolbar layout.
- Lazy routes: `/import`, `/models`, `/tables`, `/history`, plus a not-found page (server-rendered
  with a 404).
- `CliStatusService` (signals) replaces the health logic in `App`.
- AXE checks in component specs.

### Phase 2: Upload and inspect (done)

- `POST /api/inspect`:
  - multer disk upload into a per-request temp dir, removed when the response closes
  - 50 MiB limit, basename-only `.csv` names
  - returns the parsed models plus `models.go`
  - CLI rejections return 422 with gormcsv's message
- Import page: file chooser, progress, error alert, focus moved to the results.
  `ModelFieldsTable` (`mat-table`) and a copyable `CodePanel`.

### Phase 3: Model workspace (done)

- Register a model: store the CSV, regenerate `models.go`, build the workspace binary.
- Builds are serialised and timeout-bounded, and build errors are shown in the UI.
- A models list shows what the current binary can import.

### Phase 4: Migrate and populate (done)

- `POST /api/import` runs the workspace binary's `importcsv` (AutoMigrate, then batch insert) for
  one registered CSV or all of them, validating batch size and worker count.
- Parses the summary lines. A non-zero exit that still printed summary lines is a partial import:
  200 with `complete: false`, plus the row errors. `CommandError` keeps stdout for this.
- An `/api` error handler keeps malformed-JSON errors as JSON.
- Populate tables panel on the Models page: Signal Forms with Material `mat-error`, a results
  `mat-table`, and the error list.

### Phase 5: Connection config (done)

- `GORMCSV_DB_DRIVER` and `GORMCSV_DSN` are read at startup and passed to importcsv; a bad
  combination stops the server.
- The UI gets the DSN with its password masked (Postgres URL and key=value, MySQL, query
  parameters), shown on the Models page and in import summaries. Errors are scrubbed too.
- The connection details are part of `GET /api/models` rather than a separate
  `/api/database`, since only the Models page needs them so far.

### Phase 6: Schema browser (done)

- `GET /api/tables` runs a new `gormcsv tables --json`. GORM's migrator reads the catalogue, so
  SQLite, Postgres and MySQL all work with no database driver in Node. The DSN is passed in
  `GORMCSV_DSN`.
- `/tables` lists tables with row counts. `/tables/:name` shows columns in table order and
  indexes. The route parameter binds to a component input.

### Phase 7: Record browser (done)

- A new `gormcsv rows --json` pages and sorts in the database. The table and sort column are
  checked against the catalogue, so SQL in a name is rejected (tested in Go and through the API).
- `GET /api/tables/:name/rows` validates the paging values. The Rows tab on `/tables/:name`
  uses `mat-table`, `mat-sort` and `mat-paginator`, with the page, size and sort in the URL query
  bound to inputs.

### Phase 8: Import history (done)

- An append-only `history.jsonl` in the workspace, one line per registration and import: time,
  CSV, outcome (ok, partial or failed), the masked database, totals, the first 20 messages. A
  plain file rather than a SQLite file, since the log only ever needs paging newest first.
- `GET /api/history` and the `/history` page, which pages through the URL like the Rows tab.

### Later

- Schema editor to override inferred types before generating models.
- README and screenshots.
