Here is a structured, milestone-based plan to build gormcsv-admin using Angular (with its built-in Node/Express server) as a bridge to your existing gormcsv CLI tool.

Phase 1: Project Scaffolding & Core Setup

Set up a modern Angular workspace with Server-Side Rendering (SSR) enabled so you have a built-in Express server from day one.
• Initialise the Workspace. Run ng new gormcsv-admin --ssr and configure Tailwind CSS or Angular Material for clean, Django-admin-style layouts and data tables.
• Configure Code Quality. Set up ESLint, Prettier, and a basic GitHub Actions CI workflow to run linting and unit tests on every pull request.
• Verify CLI Dependency. Add a health-check endpoint (GET /api/health) in src/server.ts that runs gormcsv --version via child_process.execFile and alerts the UI if gormcsv is missing from the system PATH.

Phase 2: Database Connection & Table Explorer (Django Admin Style)

Build the core read-only database explorer so users can inspect existing tables before and after importing CSVs.
• Node Database Bridge. Add lightweight database drivers in Node (such as better-sqlite3 for local SQLite files and pg/mysql2 for external databases) to query table metadata (INFORMATION_SCHEMA or sqlite_master) and paginate rows.
• Connection State Service. Create an Angular service using Signals (signal()) to store the active database DSN/path in session storage and attach it to outgoing API requests via an HTTP Interceptor.
• Dynamic Sidebar & Data Grid. Build a persistent sidebar listing all database tables using Angular Router (/tables/:tableName). Render table rows in a paginated, sortable table with dynamic column headers.

Phase 3: CSV Inspection & Schema Mapping Workflow

Turn gormcsv's inference and model-generation capabilities into an interactive step-by-step wizard.
• File Upload & Dry-Run Endpoint. Create POST /api/inspect in src/server.ts using multer. Have it invoke gormcsv in dry-run/inspect mode to parse headers, sample rows, and infer column types.
• Interactive Schema Editor. Use Angular Reactive Forms (FormArray) to let users review each detected CSV column, rename target fields, override inferred GORM types (string, int, float, bool, time), and toggle primary keys or indexes.
• Go Struct Preview Drawer. Display the generated Go model definition (models.go) in a clean, copyable code panel so users can verify the exact GORM tags before creating the table.

Phase 4: Import Execution & History Logs

Complete the loop by running the actual import and surfacing gormcsv's structured results.
• Import Execution Endpoint. Wire POST /api/import in src/server.ts to pass the user's confirmed flags and table mapping options to gormcsv, returning structured JSON metrics (inserted rows, skipped duplicates, and validation errors).
• Progress & Result Summary. Display upload progress using HttpClient progress events (reportProgress: true), followed by a clear breakdown of imported vs. rejected rows.
• Import Audit Log. Store a history of import runs (timestamp, filename, target table, row counts, CLI exit status) in a lightweight local SQLite metadata table—mirroring django-csvimport's admin log view.

Phase 5: Open-Source Polish & Packaging

Prepare the repository for external contributors and easy local execution.
• Single-Command Launch. Add a bin entry in package.json so developers can launch the entire app locally via npx gormcsv-admin once published to npm.
• Sample Data & Quickstart. Include a samples/ directory with example CSVs and a pre-seeded SQLite database so new users can test the UI immediately after cloning.
• Documentation. Write a clear README.md covering prerequisites (Node.js and gormcsv), screenshots of the workflow, and a CONTRIBUTING.md with labelled starter issues.
Would you like to start by generating the starter folder structure and server.ts API routes for Phase 1 and Phase 2, or would you prefer to map out the exact gormcsv CLI flags you want exposed in the schema editor first?
