import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import type { RegisterResult, WorkspaceStatus } from '../shared/api-types';
import { createApiRouter } from './api-router';
import { GormcsvRunner } from './commands';
import { parseDuplicateRule } from './models';
import { ModelWorkspace, WorkspaceError } from './workspace';

const STATUS: WorkspaceStatus = {
  ready: true,
  files: ['TestTypes.csv'],
  models: [{ name: 'TestTypes', key: 'testtypes', fields: [{ name: 'Wordcol', type: 'string' }] }],
  binary: { version: 'v0.3.1-4-g5ad9de4-dirty', builtAt: '2026-11-13T11:10:04.849Z' },
  duplicates: {},
};

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'models-test-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

function stubWorkspace() {
  const seen: { path: string; filename: string; csv: string }[] = [];
  const workspace = {
    status: vi.fn(async () => STATUS),
    register: vi.fn(async (path: string, filename: string): Promise<RegisterResult> => {
      seen.push({ path, filename, csv: await readFile(path, 'utf8') });
      return { file: filename, warnings: [], status: STATUS };
    }),
  };
  return { workspace, seen };
}

function appWith(workspace: Partial<ModelWorkspace>) {
  const app = express();
  const runner = vi.fn<GormcsvRunner>();
  app.use(
    '/api',
    createApiRouter({
      runner,
      workspace: workspace as ModelWorkspace,
      upload: { tempRoot },
    }),
  );
  return app;
}

describe('GET /api/models', () => {
  it('returns the workspace status', async () => {
    const { workspace } = stubWorkspace();

    const res = await request(appWith(workspace)).get('/api/models');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(STATUS);
  });

  it('returns 500 when the status cannot be read', async () => {
    const res = await request(
      appWith({ status: vi.fn().mockRejectedValue(new Error('EACCES')) }),
    ).get('/api/models');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      ok: false,
      error: 'Reading the workspace failed',
      details: 'EACCES',
    });
  });
});

describe('POST /api/models', () => {
  it('registers the uploaded CSV under its sanitised name and returns the result', async () => {
    const { workspace, seen } = stubWorkspace();

    const res = await request(appWith(workspace))
      .post('/api/models')
      .attach('file', 'fixtures/TestTypes.csv', { filename: '../TestTypes.csv' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ file: 'TestTypes.csv', warnings: [], status: STATUS });
    expect(seen).toHaveLength(1);
    expect(seen[0].filename).toBe('TestTypes.csv');
    expect(seen[0].csv).toBe(await readFile('fixtures/TestTypes.csv', 'utf8'));
    await vi.waitFor(async () => expect(await readdir(tempRoot)).toEqual([]));
  });

  it('passes a duplicate rule sent as form fields to the workspace', async () => {
    const { workspace } = stubWorkspace();

    const res = await request(appWith(workspace))
      .post('/api/models')
      .field('duplicates', 'key')
      .field('keyColumn', 'order_id')
      .field('keyColumn', 'line')
      .attach('file', 'fixtures/TestTypes.csv');

    expect(res.status).toBe(200);
    expect(workspace.register).toHaveBeenCalledWith(expect.any(String), 'TestTypes.csv', {
      mode: 'key',
      columns: ['order_id', 'line'],
    });
  });

  it('keeps the current rule when none is sent', async () => {
    const { workspace } = stubWorkspace();

    await request(appWith(workspace)).post('/api/models').attach('file', 'fixtures/TestTypes.csv');

    expect(workspace.register).toHaveBeenCalledWith(expect.any(String), 'TestTypes.csv', undefined);
  });

  it('rejects an invalid rule with 400 without registering', async () => {
    const { workspace } = stubWorkspace();

    const res = await request(appWith(workspace))
      .post('/api/models')
      .field('duplicates', 'key')
      .attach('file', 'fixtures/TestTypes.csv');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error: 'Choose at least one key column' });
    expect(workspace.register).not.toHaveBeenCalled();
  });

  it.each([
    ['not-ready', 503],
    ['rejected', 422],
    ['build', 500],
  ] as const)('maps a %s WorkspaceError to %i', async (kind, status) => {
    const register = vi.fn().mockRejectedValue(new WorkspaceError(`${kind} happened`, kind));

    const res = await request(appWith({ register }))
      .post('/api/models')
      .attach('file', 'fixtures/TestTypes.csv');

    expect(res.status).toBe(status);
    expect(res.body).toEqual({ ok: false, error: `${kind} happened` });
  });

  it('includes build output as details', async () => {
    const register = vi
      .fn()
      .mockRejectedValue(new WorkspaceError('go build failed', 'build', 'undefined: Bogus'));

    const res = await request(appWith({ register }))
      .post('/api/models')
      .attach('file', 'fixtures/TestTypes.csv');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, error: 'go build failed', details: 'undefined: Bogus' });
  });

  it('returns 500 for unexpected errors', async () => {
    const register = vi.fn().mockRejectedValue(new Error('disk full'));

    const res = await request(appWith({ register }))
      .post('/api/models')
      .attach('file', 'fixtures/TestTypes.csv');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, error: 'Registering failed', details: 'disk full' });
  });

  it('rejects bad uploads without registering', async () => {
    const { workspace } = stubWorkspace();

    const res = await request(appWith(workspace))
      .post('/api/models')
      .attach('file', 'fixtures/TestTypes.csv', { filename: 'notes.txt' });

    expect(res.status).toBe(400);
    expect(workspace.register).not.toHaveBeenCalled();
  });
});

describe('parseDuplicateRule', () => {
  it.each([
    [{}, undefined],
    [undefined, undefined],
    [{ duplicates: 'allow' }, { mode: 'allow' }],
    [{ duplicates: 'identical', keyColumn: 'ignored' }, { mode: 'identical' }],
    [
      { duplicates: 'key', keyColumn: 'code' },
      { mode: 'key', columns: ['code'] },
    ],
    [
      { duplicates: 'key', keyColumn: ['a', 'b'] },
      { mode: 'key', columns: ['a', 'b'] },
    ],
  ])('reads %j as %j', (body, rule) => {
    expect(parseDuplicateRule(body)).toEqual(rule);
  });

  it.each([
    [{ duplicates: 'sometimes' }, 'duplicates must be allow, key or identical'],
    [{ duplicates: 'key' }, 'Choose at least one key column'],
    [{ duplicates: 'key', keyColumn: ['code', ' '] }, 'Choose at least one key column'],
    [{ duplicates: 'key', keyColumn: 'a+b' }, 'Key columns cannot contain +'],
  ])('rejects %j', (body, message) => {
    expect(parseDuplicateRule(body)).toBe(message);
  });
});

describe('without a workspace', () => {
  it('does not mount /api/models', async () => {
    const app = express();
    app.use('/api', createApiRouter({ runner: vi.fn<GormcsvRunner>() }));

    const res = await request(app).get('/api/models');

    expect(res.status).toBe(404);
  });
});
