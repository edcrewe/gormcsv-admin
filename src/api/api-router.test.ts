import express from 'express';
import request from 'supertest';
import { createApiRouter } from './api-router';
import { GormcsvError, GormcsvRunner } from './gormcsv-runner';

function appWith(runner: GormcsvRunner) {
  const app = express();
  app.use('/api', createApiRouter({ runner }));
  return app;
}

describe('GET /api/health', () => {
  it('reports ok with the version from `gormcsv version`', async () => {
    const runner = vi
      .fn<GormcsvRunner>()
      .mockResolvedValue({ stdout: 'gormcsv v0.3.1-3-g4446d92\n', stderr: '' });

    const res = await request(appWith(runner)).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, version: 'v0.3.1-3-g4446d92' });
    expect(runner).toHaveBeenCalledWith(['version']);
  });

  it('returns 503 with details when the CLI is missing', async () => {
    const runner = vi.fn<GormcsvRunner>().mockRejectedValue(new Error('spawn gormcsv ENOENT'));

    const res = await request(appWith(runner)).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      ok: false,
      error: 'gormcsv CLI not available or too old',
      details: 'spawn gormcsv ENOENT',
    });
  });

  it('returns 503 with the CLI message for a binary that predates the version command', async () => {
    const stderr =
      'Error: unknown command "version" for "gormcsv"\nRun \'gormcsv --help\' for usage.\n';
    const runner = vi
      .fn<GormcsvRunner>()
      .mockRejectedValue(new GormcsvError('Command failed: gormcsv version', stderr, 1));

    const res = await request(appWith(runner)).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      ok: false,
      error: 'gormcsv CLI not available or too old',
      details: 'unknown command "version" for "gormcsv"',
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
