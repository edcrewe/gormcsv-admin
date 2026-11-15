import express from 'express';
import request from 'supertest';
import type { ImportResult } from '../shared/api-types';
import { createApiRouter } from './api-router';
import { GormcsvRunner } from './commands';
import { parseImportRequest } from './import-route';
import { ModelWorkspace, WorkspaceError } from './workspace';

const RESULT: ImportResult = {
  complete: false,
  files: [{ model: 'Country', inserted: 245, duplicates: 0, rejected: 1 }],
  totals: { inserted: 245, duplicates: 0, rejected: 1 },
  errors: ['Country.csv row 148: record on line 148: wrong number of fields'],
  database: '/ws/gormcsv.db',
};

function appWith(workspace: Partial<ModelWorkspace>) {
  const app = express();
  app.use(
    '/api',
    createApiRouter({ runner: vi.fn<GormcsvRunner>(), workspace: workspace as ModelWorkspace }),
  );
  return app;
}

describe('parseImportRequest', () => {
  it.each([
    [
      { batchSize: 1000, workers: 4 },
      { batchSize: 1000, workers: 4 },
    ],
    [
      { file: 'Country.csv', batchSize: 1, workers: 64 },
      { file: 'Country.csv', batchSize: 1, workers: 64 },
    ],
    [
      { batchSize: 100_000, workers: 1, extra: 'ignored' },
      { batchSize: 100_000, workers: 1 },
    ],
  ])('accepts %j', (body, expected) => {
    expect(parseImportRequest(body)).toEqual(expected);
  });

  it.each([
    [null, 'Send a JSON object'],
    ['text', 'Send a JSON object'],
    [{ file: '', batchSize: 1, workers: 1 }, 'file must be a registered CSV filename'],
    [{ file: 3, batchSize: 1, workers: 1 }, 'file must be a registered CSV filename'],
    [{ workers: 1 }, 'batchSize must be a whole number from 1 to 100000'],
    [{ batchSize: 0, workers: 1 }, 'batchSize must be a whole number from 1 to 100000'],
    [{ batchSize: 1.5, workers: 1 }, 'batchSize must be a whole number from 1 to 100000'],
    [{ batchSize: '10', workers: 1 }, 'batchSize must be a whole number from 1 to 100000'],
    [{ batchSize: 100_001, workers: 1 }, 'batchSize must be a whole number from 1 to 100000'],
    [{ batchSize: 10, workers: 65 }, 'workers must be a whole number from 1 to 64'],
    [{ batchSize: 10, workers: -1 }, 'workers must be a whole number from 1 to 64'],
  ])('rejects %j', (body, message) => {
    expect(parseImportRequest(body)).toBe(message);
  });
});

describe('POST /api/import', () => {
  it('passes the validated request to the workspace and returns its result', async () => {
    const populate = vi.fn().mockResolvedValue(RESULT);

    const res = await request(appWith({ populate }))
      .post('/api/import')
      .send({ file: 'Country.csv', batchSize: 500, workers: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(RESULT);
    expect(populate).toHaveBeenCalledWith({ file: 'Country.csv', batchSize: 500, workers: 2 });
  });

  it('returns 400 for an invalid request without importing', async () => {
    const populate = vi.fn();

    const res = await request(appWith({ populate }))
      .post('/api/import')
      .send({ batchSize: 0, workers: 4 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      ok: false,
      error: 'batchSize must be a whole number from 1 to 100000',
    });
    expect(populate).not.toHaveBeenCalled();
  });

  it('returns JSON 400, not an HTML error page, for malformed JSON', async () => {
    const populate = vi.fn();

    const res = await request(appWith({ populate }))
      .post('/api/import')
      .set('Content-Type', 'application/json')
      .send('{bad');

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toMatchObject({ ok: false, error: 'Bad request' });
    expect(populate).not.toHaveBeenCalled();
  });

  it.each([
    ['not-ready', 503],
    ['not-found', 404],
    ['failed', 500],
  ] as const)('maps a %s WorkspaceError to %i', async (kind, status) => {
    const populate = vi
      .fn()
      .mockRejectedValue(new WorkspaceError(`${kind} happened`, kind, 'some details'));

    const res = await request(appWith({ populate }))
      .post('/api/import')
      .send({ batchSize: 10, workers: 1 });

    expect(res.status).toBe(status);
    expect(res.body).toEqual({ ok: false, error: `${kind} happened`, details: 'some details' });
  });

  it('returns 500 for unexpected errors', async () => {
    const populate = vi.fn().mockRejectedValue(new Error('disk full'));

    const res = await request(appWith({ populate }))
      .post('/api/import')
      .send({ batchSize: 10, workers: 1 });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ ok: false, error: 'Import failed', details: 'disk full' });
  });
});
