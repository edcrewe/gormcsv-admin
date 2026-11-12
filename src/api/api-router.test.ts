import express from 'express';
import request from 'supertest';
import { createApiRouter } from './api-router';
import { GormcsvRunner } from './gormcsv-runner';

function appWith(runner: GormcsvRunner) {
  const app = express();
  app.use('/api', createApiRouter({ runner }));
  return app;
}

describe('GET /api/health', () => {
  it('reports ok with the first help line when the CLI runs', async () => {
    const runner = vi.fn<GormcsvRunner>().mockResolvedValue({
      stdout: 'Generate GORM models from CSV files\n\nUsage:\n  gormcsv [command]\n',
      stderr: '',
    });

    const res = await request(appWith(runner)).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, summary: 'Generate GORM models from CSV files' });
    expect(runner).toHaveBeenCalledWith(['--help']);
  });

  it('returns 503 with details when the CLI is missing', async () => {
    const runner = vi.fn<GormcsvRunner>().mockRejectedValue(new Error('spawn gormcsv ENOENT'));

    const res = await request(appWith(runner)).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      ok: false,
      error: 'gormcsv CLI not available',
      details: 'spawn gormcsv ENOENT',
    });
  });

  it('handles non-Error rejections', async () => {
    const runner = vi.fn<GormcsvRunner>().mockRejectedValue('boom');

    const res = await request(appWith(runner)).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body.details).toBe('boom');
  });
});

describe('unknown API routes', () => {
  it('return JSON 404 rather than falling through to the Angular renderer', async () => {
    const runner = vi.fn<GormcsvRunner>();

    const res = await request(appWith(runner)).get('/api/missing');

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body).toEqual({ ok: false, error: 'Not found' });
    expect(runner).not.toHaveBeenCalled();
  });
});
