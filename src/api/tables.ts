/**
 * GET /api/tables: what is in the import database; GET /api/tables/:name/rows: one page of a
 * table. They run `gormcsv tables --json` and `gormcsv rows --json`, which read the database
 * through GORM, so SQLite, Postgres and MySQL all work without a database driver in Node. The
 * connection goes in GORMCSV_DSN, as for imports, so the password stays out of the process list
 * and out of the response, which only carries the masked DSN. Reports are shape-checked, and a
 * gormcsv without the command gets a clear "too old". Paging values are validated here; table
 * and column names are checked by gormcsv against the database's own catalogue, the only
 * reliable list of what exists, and arrive as arguments with no shell in between.
 */

import { Request, Response, Router } from 'express';
import type { RowsPage, TableInfo, TablesResponse } from '../shared/api-types';
import { CommandError, GormcsvRunner, errorMessage } from './commands';
import { DatabaseConfig, databaseInfo, scrub } from './database';

export interface TablesDeps {
  runner: GormcsvRunner;
  database: DatabaseConfig;
}

type Command = 'tables' | 'rows';

const TOO_OLD: Record<Command, string> = {
  tables: 'gormcsv is too old to list tables; install one with the tables command',
  rows: 'gormcsv is too old to read rows; install one with the rows command',
};

/** gormcsv's own cap on one page. */
export const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 25;

export interface RowsRequest {
  limit: number;
  offset: number;
  sort?: string;
  desc: boolean;
}

/** Reads ?limit, ?offset, ?sort and ?dir, or returns a message saying what is wrong. */
export function parseRowsQuery(query: Record<string, unknown>): RowsRequest | string {
  const whole = (value: unknown, fallback: number) => {
    if (value === undefined) return fallback;
    return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  };
  const limit = whole(query['limit'], DEFAULT_LIMIT);
  const offset = whole(query['offset'], 0);
  if (!(limit >= 1 && limit <= MAX_LIMIT)) {
    return `limit must be a whole number from 1 to ${MAX_LIMIT}`;
  }
  if (!(offset >= 0)) return 'offset must be a whole number, 0 or more';
  const sort = query['sort'];
  if (sort !== undefined && (typeof sort !== 'string' || sort === '')) {
    return 'sort must name a column';
  }
  const dir = query['dir'] ?? 'asc';
  if (dir !== 'asc' && dir !== 'desc') return 'dir must be asc or desc';
  return { limit, offset, desc: dir === 'desc', ...(typeof sort === 'string' && { sort }) };
}

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/** Validates `gormcsv tables --json` output. */
export function parseTablesReport(stdout: string): TableInfo[] | null {
  const tables = (parseJson(stdout) as { tables?: unknown } | null)?.tables;
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

/** Validates `gormcsv rows --json` output. */
export function parseRowsReport(stdout: string): RowsPage | null {
  const page = parseJson(stdout) as Partial<RowsPage> | null;
  const valid =
    typeof page?.table === 'string' &&
    Array.isArray(page.columns) &&
    Array.isArray(page.rows) &&
    page.rows.every((row) => Array.isArray(row)) &&
    typeof page.total === 'number';
  return valid ? (page as RowsPage) : null;
}

export function createTablesRouter({ runner, database }: TablesDeps): Router {
  const router = Router();
  const env = { GORMCSV_DSN: database.dsn };

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const { stdout } = await runner(['tables', '--driver', database.driver, '--json'], { env });
      const tables = parseTablesReport(stdout);
      if (!tables) {
        res.status(503).json({ ok: false, error: TOO_OLD.tables });
        return;
      }
      const body: TablesResponse = { database: databaseInfo(database), tables };
      res.json(body);
    } catch (err: unknown) {
      sendCommandError(res, err, 'tables', database);
    }
  });

  router.get('/:name/rows', async (req: Request, res: Response) => {
    const query = parseRowsQuery(req.query as Record<string, unknown>);
    if (typeof query === 'string') {
      res.status(400).json({ ok: false, error: query });
      return;
    }
    const args = [
      'rows',
      ['--table', String(req.params['name'])],
      ['--limit', String(query.limit)],
      ['--offset', String(query.offset)],
      query.sort ? ['--order', query.sort] : [],
      query.desc ? ['--desc'] : [],
      ['--driver', database.driver],
      '--json',
    ].flat();
    try {
      const page = parseRowsReport((await runner(args, { env })).stdout);
      if (!page) {
        res.status(503).json({ ok: false, error: TOO_OLD.rows });
        return;
      }
      res.json(page);
    } catch (err: unknown) {
      // gormcsv says "no table ..." or "no column ..." for names the catalogue lacks.
      const message = err instanceof CommandError ? err.cliMessage : '';
      if (message.startsWith('no table ')) {
        res.status(404).json({ ok: false, error: message });
      } else if (message.startsWith('no column ')) {
        res.status(400).json({ ok: false, error: message });
      } else {
        sendCommandError(res, err, 'rows', database);
      }
    }
  });

  return router;
}

function sendCommandError(
  res: Response,
  err: unknown,
  command: Command,
  database: DatabaseConfig,
): void {
  if (err instanceof CommandError && err.stderr.includes(`unknown command "${command}"`)) {
    res.status(503).json({ ok: false, error: TOO_OLD[command] });
  } else if (err instanceof CommandError && !err.timedOut && err.exitCode !== null) {
    // Typically the database cannot be reached; the driver's message says why.
    res.status(502).json({ ok: false, error: scrub(err.cliMessage, database) });
  } else {
    const error = command === 'tables' ? 'Listing tables failed' : 'Reading rows failed';
    res.status(500).json({ ok: false, error, details: scrub(errorMessage(err), database) });
  }
}
