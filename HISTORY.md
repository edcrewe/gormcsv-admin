# Changelog

## Unreleased

- Needs gormcsv `v0.4.0` or later, which CI now builds instead of gormcsv master.
- Every `gormcsv --json` report is checked all the way down before it is used: counts must be
  whole numbers, each row must have a value per column, and cells must be plain values. A report
  of another shape gets a 503 naming the command, rather than reaching the page as broken data.
- Integers too large for a JavaScript number, which gormcsv `rows --json` gives as strings, show
  exactly as stored in the Rows tab.
- The Rows tab and History page share one paging parser. `limit` and `offset` must be plain whole
  numbers, and offsets are capped at 2,147,483,647, so a value like `1e400` or
  `9007199254740993` gets a 400 instead of failing inside gormcsv. A huge page number typed into
  the URL is capped the same way.
- A page past the end, from a bookmark or after rows were deleted, says so and points to First
  page, instead of showing a range like `1000–999`.
- The "too old" messages for Tables and Rows name the gormcsv version to install.

## 0.1.0 - First release - 22 Nov 2026

- A django-admin-style UI for gormcsv, served by Angular SSR with an Express API that runs the
  `gormcsv` CLI. It binds to `127.0.0.1` by default, and the browser never sends or sees a DSN.
- Import CSV: upload a CSV, preview the GORM model, warnings and `models.go`, then register it.
  Registering rebuilds a workspace gormcsv with every registered model, swapping the binary and
  the models it reports in together, and restoring the previous CSVs, `models.go` and binary if
  anything fails.
- Duplicate rules per model: import again, skip rows whose key columns match (`--key`), or skip
  identical rows (`--dedupe`). Re-registering a model keeps its rule unless it is changed.
- Models: what the workspace binary can import, and Populate, which migrates and loads one or all
  registered CSVs, reporting partial imports with their row errors.
- Import database from `GORMCSV_DB_DRIVER` and `GORMCSV_DSN` (SQLite, PostgreSQL or MySQL), shown
  with the password masked and passed to gormcsv in its environment, out of the process list.
- Tables: each table's row count, columns and indexes, and a Rows tab that pages and sorts in the
  database, with the view kept in the URL.
- History: every registration and import, newest first, from `history.jsonl` in the workspace.
- `gormcsv-admin` command to start the built server, and `samples/` CSVs with a walkthrough.
- A `v*` tag builds, tests and publishes a release archive and an SPDX SBOM.
