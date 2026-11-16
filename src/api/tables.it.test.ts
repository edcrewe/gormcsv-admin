import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import express from 'express';
import request from 'supertest';
import { createApiRouter } from './api-router';
import { createExecRunner } from './commands';
import { databaseFromEnv } from './database';

const exec = promisify(execFile);
const binary = process.env['GORMCSV_BIN'] || 'gormcsv';
const postgresDsn = process.env['GORMCSV_TEST_POSTGRES_DSN'];

// Opt-in: runs the real gormcsv (GORMCSV_BIN or PATH). Run with `npm run test:server:it`.
describe.skipIf(!process.env['GORMCSV_IT'])('GET /api/tables with the real gormcsv CLI', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'tables-it-'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function appFor(env: Record<string, string | undefined>) {
    const app = express();
    const database = databaseFromEnv(env, join(root, 'unused.db'));
    app.use('/api', createApiRouter({ runner: createExecRunner({ binary }), database }));
    return app;
  }

  it('describes a SQLite database the CLI imported into', async () => {
    const dsn = join(root, 'tables.db');
    // The released binary has the TestTypes model compiled in.
    await exec(binary, ['importcsv', '--files', 'fixtures/TestTypes.csv', '--dsn', dsn]);

    const res = await request(appFor({ GORMCSV_DSN: dsn })).get('/api/tables');

    expect(res.status).toBe(200);
    expect(res.body.database).toEqual({ driver: 'sqlite', dsn });
    const [testTypes] = res.body.tables;
    expect(res.body.tables).toHaveLength(1);
    expect(testTypes).toMatchObject({ name: 'test_types', rows: 6 });
    expect(testTypes.columns[0]).toMatchObject({ name: 'id', primaryKey: true });
    expect(testTypes.columns.map((c: { name: string }) => c.name)).toContain('datecol');
    expect(testTypes.indexes).toContainEqual({
      name: 'idx_test_types_deleted_at',
      columns: ['deleted_at'],
      unique: false,
    });
  });

  it('reports an empty database as no tables', async () => {
    const res = await request(appFor({ GORMCSV_DSN: join(root, 'empty.db') })).get('/api/tables');

    expect(res.status).toBe(200);
    expect(res.body.tables).toEqual([]);
  });

  it.skipIf(!postgresDsn)('describes Postgres, with the password masked', async () => {
    await exec(binary, ['importcsv', '--files', 'fixtures/TestTypes.csv', '--driver', 'postgres'], {
      env: { ...process.env, GORMCSV_DSN: postgresDsn },
    });

    const res = await request(
      appFor({ GORMCSV_DB_DRIVER: 'postgres', GORMCSV_DSN: postgresDsn }),
    ).get('/api/tables');

    expect(res.status).toBe(200);
    expect(res.body.database.dsn).toContain(':***@');
    const testTypes = res.body.tables.find((t: { name: string }) => t.name === 'test_types');
    expect(testTypes.rows).toBeGreaterThanOrEqual(6);
    expect(testTypes.columns[0]).toMatchObject({ name: 'id', type: 'bigint', primaryKey: true });
  });
});
