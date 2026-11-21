/**
 * The import history: one JSON line per registration or import, appended to history.jsonl in the
 * workspace, like django-csvimport's import log. A line-per-entry file needs no database of its
 * own and survives crashes well: an interrupted write damages at most its own last line, which
 * list() skips. Appends are queued so concurrent requests never interleave their lines. list()
 * reads the whole file and pages it newest first, which is fine for an admin's log; a very busy
 * one could be rotated by hand. Entries are recorded after the work finishes, by the routes, so
 * the workspace itself stays unaware of logging. GET /api/history serves the log a page at a time.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Request, Response, Router } from 'express';
import type { HistoryEntry, HistoryPage } from '../shared/api-types';
import { errorMessage } from './commands';

/** Row errors kept per entry; an import can reject thousands. */
export const ERRORS_KEPT = 20;

export class HistoryLog {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly path: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Records an entry, stamped with the current time; never throws, so logging cannot fail a request. */
  record(entry: Omit<HistoryEntry, 'at'>): Promise<void> {
    const stamped: HistoryEntry = {
      at: this.now().toISOString(),
      ...entry,
      ...(entry.errors && { errors: entry.errors.slice(0, ERRORS_KEPT) }),
    };
    const write = this.queue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await appendFile(this.path, JSON.stringify(stamped) + '\n');
    });
    this.queue = write.catch(() => undefined);
    return write.catch((err: unknown) => {
      console.error('Could not write import history:', err);
    });
  }

  /** Entries newest first, skipping any line that is not a complete entry. */
  async list(limit: number, offset: number): Promise<HistoryPage> {
    await this.queue;
    const text = await readFile(this.path, 'utf8').catch(() => '');
    const entries: HistoryEntry[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as HistoryEntry;
        if (typeof entry.at === 'string' && typeof entry.action === 'string') entries.push(entry);
      } catch {
        // A partial line from an interrupted write.
      }
    }
    entries.reverse();
    return { entries: entries.slice(offset, offset + limit), total: entries.length, limit, offset };
  }
}

const MAX_PAGE = 200;

/** Reads ?limit (1-200, default 25) and ?offset, or returns what is wrong with them. */
export function parsePaging(
  query: Record<string, unknown>,
): { limit: number; offset: number } | string {
  const whole = (value: unknown, fallback: number) => {
    if (value === undefined) return fallback;
    return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  };
  const limit = whole(query['limit'], 25);
  const offset = whole(query['offset'], 0);
  if (!(limit >= 1 && limit <= MAX_PAGE))
    return `limit must be a whole number from 1 to ${MAX_PAGE}`;
  if (!(offset >= 0)) return 'offset must be a whole number, 0 or more';
  return { limit, offset };
}

/** GET /api/history: one page of the log, newest first. */
export function createHistoryRouter({ history }: { history: HistoryLog }): Router {
  const router = Router();
  router.get('/', async (req: Request, res: Response) => {
    const paging = parsePaging(req.query as Record<string, unknown>);
    if (typeof paging === 'string') {
      res.status(400).json({ ok: false, error: paging });
      return;
    }
    try {
      res.json(await history.list(paging.limit, paging.offset));
    } catch (err: unknown) {
      res
        .status(500)
        .json({ ok: false, error: 'Reading the history failed', details: errorMessage(err) });
    }
  });
  return router;
}
