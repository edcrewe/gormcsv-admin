import express from 'express';
import request from 'supertest';
import { createApiRouter } from './api-router';
import { CommandError, GormcsvRunner } from './commands';
import { DatabaseConfig } from './database';
import { parseTablesReport } from './tables';

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

describe('parseTablesReport', () => {
  it('accepts a report of tables', () => {
    expect(parseTablesReport(JSON.stringify({ tables: [TABLE] }))).toEqual([TABLE]);
    expect(parseTablesReport('{"tables": []}')).toEqual([]);
  });

  it.each([
    ['text output', 'countries: 245 rows, 19 columns\n'],
    ['no tables list', '{}'],
    ['a table without rows', '{"tables": [{"name": "x", "columns": [], "indexes": []}]}'],
    ['a table without indexes', '{"tables": [{"name": "x", "rows": 1, "columns": []}]}'],
  ])('rejects %s', (_label, stdout) => {
    expect(parseTablesReport(stdout)).toBeNull();
  });
});

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
