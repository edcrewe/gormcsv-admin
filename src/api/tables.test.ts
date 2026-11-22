import express from 'express';
import request from 'supertest';
import { createApiRouter } from './api-router';
import { CommandError, GormcsvRunner } from './commands';
import { DatabaseConfig } from './database';
import { parseRowsQuery } from './tables';

const TABLE = {
  name: 'countries',
  rows: 245,
  columns: [{ name: 'id', type: 'bigint', nullable: false, primaryKey: true }],
  indexes: [{ name: 'idx_countries_code', columns: ['code'], unique: true }],
};
const POSTGRES: DatabaseConfig = {
  driver: 'postgres',
  dsn: 'postgres://ed:s3cret@db:5432/admin?sslmode=disable',
};

function appWith(runner: GormcsvRunner, database: DatabaseConfig = POSTGRES) {
  const app = express();
  app.use('/api', createApiRouter({ runner, database }));
  return app;
}

describe('GET /api/tables', () => {
  it('runs gormcsv tables with the DSN in the environment and returns the masked database', async () => {
    const runner = vi
      .fn<GormcsvRunner>()
      .mockResolvedValue({ stdout: JSON.stringify({ tables: [TABLE] }), stderr: '' });

    const res = await request(appWith(runner)).get('/api/tables');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      database: { driver: 'postgres', dsn: 'postgres://ed:***@db:5432/admin?sslmode=disable' },
      tables: [TABLE],
    });
    expect(runner).toHaveBeenCalledWith(['tables', '--driver', 'postgres', '--json'], {
      env: { GORMCSV_DSN: POSTGRES.dsn },
    });
  });

  it('returns 503 when gormcsv has no tables command', async () => {
    const stderr = 'Error: unknown command "tables" for "gormcsv"\n';
    const runner = vi.fn<GormcsvRunner>().mockRejectedValue(new CommandError('exit 1', stderr, 1));

    const res = await request(appWith(runner)).get('/api/tables');

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/too old to list tables/);
  });

  it('returns 503 when the output is not a tables report', async () => {
    const runner = vi
      .fn<GormcsvRunner>()
      .mockResolvedValue({ stdout: 'countries: 1 rows', stderr: '' });

    const res = await request(appWith(runner)).get('/api/tables');

    expect(res.status).toBe(503);
  });

  it('returns 502 with the driver message, password hidden, when the database is unreachable', async () => {
    const stderr =
      '\n2026/11/16 [error] failed to initialize database\n' +
      'Error: open postgres database: auth failed for password s3cret\n';
    const runner = vi.fn<GormcsvRunner>().mockRejectedValue(new CommandError('exit 1', stderr, 1));

    const res = await request(appWith(runner)).get('/api/tables');

    expect(res.status).toBe(502);
    expect(res.body).toEqual({
      ok: false,
      error: 'open postgres database: auth failed for password ***',
    });
  });

  it('returns 500, scrubbed, when gormcsv cannot run', async () => {
    const runner = vi
      .fn<GormcsvRunner>()
      .mockRejectedValue(new CommandError('gormcsv timed out; dsn s3cret', '', null, true));

    const res = await request(appWith(runner)).get('/api/tables');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      ok: false,
      error: 'Listing tables failed',
      details: 'gormcsv timed out; dsn ***',
    });
  });

  it('is not mounted without a database config', async () => {
    const app = express();
    app.use('/api', createApiRouter({ runner: vi.fn<GormcsvRunner>() }));

    const res = await request(app).get('/api/tables');

    expect(res.status).toBe(404);
  });
});

const PAGE = {
  table: 'countries',
  columns: ['id', 'name'],
  rows: [
    [1, 'Afghanistan'],
    [2, null],
  ],
  total: 245,
  limit: 2,
  offset: 0,
  order: 'id',
  desc: false,
};

describe('parseRowsQuery', () => {
  it.each([
    [{}, { limit: 25, offset: 0, desc: false }],
    [
      { limit: '50', offset: '100', sort: 'name', dir: 'desc' },
      { limit: 50, offset: 100, sort: 'name', desc: true },
    ],
    [
      { dir: 'asc', limit: '1000' },
      { limit: 1000, offset: 0, desc: false },
    ],
  ])('reads %j', (query, request) => {
    expect(parseRowsQuery(query)).toEqual(request);
  });

  it.each([
    [{ limit: '0' }, 'limit must be a whole number from 1 to 1000'],
    [{ limit: '1001' }, 'limit must be a whole number from 1 to 1000'],
    [{ limit: '2.5' }, 'limit must be a whole number from 1 to 1000'],
    [{ limit: ['1', '2'] }, 'limit must be a whole number from 1 to 1000'],
    [{ offset: '-1' }, 'offset must be a whole number from 0 to 2147483647'],
    [{ sort: '' }, 'sort must name a column'],
    [{ sort: ['a', 'b'] }, 'sort must name a column'],
    [{ dir: 'up' }, 'dir must be asc or desc'],
  ])('rejects %j', (query, message) => {
    expect(parseRowsQuery(query)).toBe(message);
  });
});

describe('GET /api/tables/:name/rows', () => {
  const okRunner = () =>
    vi.fn<GormcsvRunner>().mockResolvedValue({ stdout: JSON.stringify(PAGE), stderr: '' });

  it('runs gormcsv rows with the paging and sort, and the DSN in the environment', async () => {
    const runner = okRunner();

    const res = await request(appWith(runner)).get(
      '/api/tables/countries/rows?limit=2&offset=4&sort=name&dir=desc',
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual(PAGE);
    expect(runner).toHaveBeenCalledWith(
      [
        'rows',
        '--table',
        'countries',
        '--limit',
        '2',
        '--offset',
        '4',
        '--order',
        'name',
        '--desc',
        '--driver',
        'postgres',
        '--json',
      ],
      { env: { GORMCSV_DSN: POSTGRES.dsn } },
    );
  });

  it('leaves out --order and --desc by default', async () => {
    const runner = okRunner();

    await request(appWith(runner)).get('/api/tables/countries/rows');

    const args = runner.mock.calls[0][0];
    expect(args).not.toContain('--order');
    expect(args).not.toContain('--desc');
    expect(args).toContain('25');
  });

  it('passes an odd table name through as one argument, for gormcsv to reject', async () => {
    const runner = vi
      .fn<GormcsvRunner>()
      .mockRejectedValue(
        new CommandError('exit 1', 'Error: no table "x; drop table y": not found\n', 1),
      );

    const res = await request(appWith(runner)).get('/api/tables/x%3B%20drop%20table%20y/rows');

    expect(runner.mock.calls[0][0].slice(0, 3)).toEqual(['rows', '--table', 'x; drop table y']);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ ok: false, error: 'no table "x; drop table y": not found' });
  });

  it('returns 400 for a sort column the table does not have', async () => {
    const stderr = 'Error: no column "nope" in "countries": not found\n';
    const runner = vi.fn<GormcsvRunner>().mockRejectedValue(new CommandError('exit 1', stderr, 1));

    const res = await request(appWith(runner)).get('/api/tables/countries/rows?sort=nope');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no column "nope" in "countries": not found');
  });

  it('returns 400 for bad paging without running gormcsv', async () => {
    const runner = okRunner();

    const res = await request(appWith(runner)).get('/api/tables/countries/rows?limit=5000');

    expect(res.status).toBe(400);
    expect(runner).not.toHaveBeenCalled();
  });

  it('returns 503 when gormcsv has no rows command', async () => {
    const stderr = 'Error: unknown command "rows" for "gormcsv"\n';
    const runner = vi.fn<GormcsvRunner>().mockRejectedValue(new CommandError('exit 1', stderr, 1));

    const res = await request(appWith(runner)).get('/api/tables/countries/rows');

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/too old to read rows/);
  });

  it('returns 502 with the password scrubbed when the database is unreachable', async () => {
    const stderr = 'Error: open postgres database: bad password s3cret\n';
    const runner = vi.fn<GormcsvRunner>().mockRejectedValue(new CommandError('exit 1', stderr, 1));

    const res = await request(appWith(runner)).get('/api/tables/countries/rows');

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('open postgres database: bad password ***');
  });
});
