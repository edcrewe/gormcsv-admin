import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { createApiRouter } from './api-router';
import { GormcsvRunner } from './commands';
import { ERRORS_KEPT, HistoryLog } from './history';

let dir: string;
let clock: number;
const log = () => new HistoryLog(join(dir, 'history.jsonl'), () => new Date(clock++ * 1000));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'history-test-'));
  clock = 0;
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('HistoryLog', () => {
  it('appends stamped JSON lines and lists them newest first', async () => {
    const history = log();
    await history.record({ action: 'register', outcome: 'ok', file: 'a.csv' });
    await history.record({ action: 'import', outcome: 'partial', file: 'a.csv' });

    const lines = (await readFile(history.path, 'utf8')).trim().split('\n');
    expect(lines.map((l) => JSON.parse(l).at)).toEqual([
      '1970-01-01T00:00:00.000Z',
      '1970-01-01T00:00:01.000Z',
    ]);
    const page = await history.list(10, 0);
    expect(page.total).toBe(2);
    expect(page.entries.map((e) => e.action)).toEqual(['import', 'register']);
  });

  it('pages with limit and offset', async () => {
    const history = log();
    for (const file of ['a', 'b', 'c', 'd', 'e']) {
      await history.record({ action: 'register', outcome: 'ok', file });
    }

    const page = await history.list(2, 1);

    expect(page).toMatchObject({ total: 5, limit: 2, offset: 1 });
    expect(page.entries.map((e) => e.file)).toEqual(['d', 'c']);
  });

  it('is empty, not an error, before anything is logged', async () => {
    expect(await log().list(10, 0)).toEqual({ entries: [], total: 0, limit: 10, offset: 0 });
  });

  it('keeps only the first row errors', async () => {
    const history = log();
    const errors = Array.from({ length: 50 }, (_, i) => `row ${i}`);

    await history.record({ action: 'import', outcome: 'partial', errors });

    const [entry] = (await history.list(1, 0)).entries;
    expect(entry.errors).toHaveLength(ERRORS_KEPT);
    expect(entry.errors?.[0]).toBe('row 0');
  });

  it('skips a partial line left by an interrupted write', async () => {
    const history = log();
    await history.record({ action: 'register', outcome: 'ok', file: 'good.csv' });
    await appendFile(history.path, '{"at":"2026-01-01","act');
    await appendFile(history.path, '\n{"no":"action"}\n');

    const page = await history.list(10, 0);

    expect(page.entries.map((e) => e.file)).toEqual(['good.csv']);
  });

  it('never interleaves concurrent records', async () => {
    const history = log();

    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        history.record({ action: 'import', outcome: 'ok', file: `f${i}.csv` }),
      ),
    );

    expect((await history.list(50, 0)).total).toBe(20);
  });

  it('lists records still being written, in the order they were made', async () => {
    const history = log();
    for (const file of ['first', 'second', 'third']) {
      void history.record({ action: 'register', outcome: 'ok', file });
    }

    const page = await history.list(10, 0);

    expect(page.entries.map((e) => e.file)).toEqual(['third', 'second', 'first']);
  });

  it('logs and swallows a write failure rather than failing the request', async () => {
    // A path inside a regular file can never be written (ENOTDIR).
    await appendFile(join(dir, 'a-file'), 'x');
    const history = new HistoryLog(join(dir, 'a-file', 'history.jsonl'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(history.record({ action: 'register', outcome: 'ok' })).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('GET /api/history', () => {
  function appWith(history?: HistoryLog) {
    const app = express();
    app.use('/api', createApiRouter({ runner: vi.fn<GormcsvRunner>(), history }));
    return app;
  }

  it('returns a page of the log', async () => {
    const history = log();
    await history.record({ action: 'register', outcome: 'failed', message: 'boom' });

    const res = await request(appWith(history)).get('/api/history?limit=5');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      entries: [
        { at: '1970-01-01T00:00:00.000Z', action: 'register', outcome: 'failed', message: 'boom' },
      ],
      total: 1,
      limit: 5,
      offset: 0,
    });
  });

  it('rejects bad paging with 400', async () => {
    const res = await request(appWith(log())).get('/api/history?limit=1000');

    expect(res.status).toBe(400);
  });

  it('is not mounted without a history log', async () => {
    expect((await request(appWith()).get('/api/history')).status).toBe(404);
  });
});
