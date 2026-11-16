/**
 * GET /api/tables: what is in the import database. It runs `gormcsv tables --json`, which reads
 * the database's own catalogue through GORM, so SQLite, Postgres and MySQL all work without a
 * database driver in Node. The connection goes in GORMCSV_DSN, as for imports, so the password
 * stays out of the process list and out of the response, which only carries the masked DSN. The
 * report's shape is checked, and a gormcsv without the tables command gets a clear "too old".
 */

import { Request, Response, Router } from 'express';
import type { TableInfo, TablesResponse } from '../shared/api-types';
import { CommandError, GormcsvRunner, errorMessage } from './commands';
import { DatabaseConfig, databaseInfo, scrub } from './database';

export interface TablesDeps {
  runner: GormcsvRunner;
  database: DatabaseConfig;
}

const TOO_OLD = 'gormcsv is too old to list tables; install one with the tables command';

/** Validates `gormcsv tables --json` output. */
export function parseTablesReport(stdout: string): TableInfo[] | null {
  let report: unknown;
  try {
    report = JSON.parse(stdout);
  } catch {
    return null;
  }
  const tables = (report as { tables?: unknown })?.tables;
  if (!Array.isArray(tables)) return null;
  const valid = tables.every(
    (t) =>
      typeof t === 'object' &&
      t !== null &&
      typeof t.name === 'string' &&
      typeof t.rows === 'number' &&
      Array.isArray(t.columns) &&
      Array.isArray(t.indexes),
  );
  return valid ? (tables as TableInfo[]) : null;
}

export function createTablesRouter({ runner, database }: TablesDeps): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const { stdout } = await runner(['tables', '--driver', database.driver, '--json'], {
        env: { GORMCSV_DSN: database.dsn },
      });
      const tables = parseTablesReport(stdout);
      if (!tables) {
        res.status(503).json({ ok: false, error: TOO_OLD });
        return;
      }
      const body: TablesResponse = { database: databaseInfo(database), tables };
      res.json(body);
    } catch (err: unknown) {
      if (err instanceof CommandError && /unknown command "tables"/.test(err.stderr)) {
        res.status(503).json({ ok: false, error: TOO_OLD });
        return;
      }
      if (err instanceof CommandError && !err.timedOut && err.exitCode !== null) {
        // Typically the database cannot be reached; the driver's message says why.
        res.status(502).json({ ok: false, error: scrub(err.cliMessage, database) });
        return;
      }
      res.status(500).json({
        ok: false,
        error: 'Listing tables failed',
        details: scrub(errorMessage(err), database),
      });
    }
  });

  return router;
}
