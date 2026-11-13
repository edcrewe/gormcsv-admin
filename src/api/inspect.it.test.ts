import express from 'express';
import request from 'supertest';
import { createApiRouter } from './api-router';
import { createExecRunner } from './gormcsv-runner';

// Opt-in: runs the real gormcsv binary (GORMCSV_BIN or PATH). Run with `npm run test:server:it`.
describe.skipIf(!process.env['GORMCSV_IT'])('POST /api/inspect with the real gormcsv CLI', () => {
  const app = express();
  app.use(
    '/api',
    createApiRouter({ runner: createExecRunner({ binary: process.env['GORMCSV_BIN'] }) }),
  );

  it('generates the TestTypes model from the gormcsv fixture', async () => {
    const res = await request(app).post('/api/inspect').attach('file', 'fixtures/TestTypes.csv');

    expect(res.status).toBe(200);
    expect(res.body.models).toEqual([
      {
        name: 'TestTypes',
        key: 'testtypes',
        fields: [
          { name: 'Wordcol', type: 'string' },
          { name: 'Codecol', type: 'string' },
          { name: 'Textcol', type: 'string' },
          { name: 'Bigtextcol', type: 'string' },
          { name: 'Numbercol', type: 'float64' },
          { name: 'Intcol', type: 'int16' },
          { name: 'Boolcol', type: 'bool' },
          { name: 'Datecol', type: 'time.Time' },
        ],
      },
    ]);
    expect(res.body.source).toContain('"testtypes": func() any { return &TestTypes{} }');
  });

  it('derives the model name from the uploaded filename', async () => {
    const res = await request(app)
      .post('/api/inspect')
      .attach('file', 'fixtures/TestTypes.csv', { filename: 'order-item.csv' });

    expect(res.status).toBe(200);
    expect(res.body.models[0]).toMatchObject({ name: 'OrderItem', key: 'order-item' });
  });

  // Country.csv has a deliberately short row (line 148). importcsv skips it; inspectcsv rejects the file.
  it('returns 422 for the malformed Country fixture', async () => {
    const res = await request(app).post('/api/inspect').attach('file', 'fixtures/Country.csv');

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      ok: false,
      error: 'inspect "Country.csv": record on line 148: wrong number of fields',
    });
  });
});
