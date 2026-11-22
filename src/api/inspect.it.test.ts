import express from 'express';
import request from 'supertest';
import { createApiRouter } from './api-router';
import { createExecRunner } from './commands';

// Opt-in: runs the real gormcsv binary (GORMCSV_BIN or PATH). Run with `npm run test:server:it`.
describe.skipIf(!process.env['GORMCSV_IT'])('POST /api/inspect with the real gormcsv CLI', () => {
  const app = express();
  app.use(
    '/api',
    createApiRouter({ runner: createExecRunner({ binary: process.env['GORMCSV_BIN'] }) }),
  );

  it('reports a git-describe style version from GET /api/health', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    // v0.4.0 on a tag, v0.4.0-3-g4446d92 after one, optionally -dirty.
    expect(res.body.version).toMatch(/^v\d+\.\d+\.\d+(-\d+-g[0-9a-f]{7,})?(-dirty)?$/);
  });

  it('generates the TestTypes model from the gormcsv fixture', async () => {
    const res = await request(app).post('/api/inspect').attach('file', 'fixtures/TestTypes.csv');

    expect(res.status).toBe(200);
    expect(res.body.models).toEqual([
      {
        name: 'TestTypes',
        key: 'testtypes',
        fields: [
          { name: 'Wordcol', type: 'string', column: 'wordcol' },
          { name: 'Codecol', type: 'string', column: 'codecol' },
          { name: 'Textcol', type: 'string', column: 'textcol' },
          { name: 'Bigtextcol', type: 'string', column: 'bigtextcol' },
          { name: 'Numbercol', type: 'float64', column: 'numbercol' },
          { name: 'Intcol', type: 'int16', column: 'intcol' },
          { name: 'Boolcol', type: 'bool', column: 'boolcol' },
          { name: 'Datecol', type: 'time.Time', column: 'datecol' },
        ],
      },
    ]);
    expect(res.body.source).toContain('"testtypes": func() any { return &TestTypes{} }');
    expect(res.body.warnings).toEqual([]);
  });

  it('derives the model name from the uploaded filename', async () => {
    const res = await request(app)
      .post('/api/inspect')
      .attach('file', 'fixtures/TestTypes.csv', { filename: 'order-item.csv' });

    expect(res.status).toBe(200);
    expect(res.body.models[0]).toMatchObject({ name: 'OrderItem', key: 'order-item' });
  });

  // Country.csv has a deliberately short row (line 148) and a "model" column, which gormcsv renames.
  it('generates the Country model and warns about the skipped short row', async () => {
    const res = await request(app).post('/api/inspect').attach('file', 'fixtures/Country.csv');

    expect(res.status).toBe(200);
    expect(res.body.models[0]).toMatchObject({ name: 'Country', key: 'country' });
    expect(res.body.models[0].fields[0]).toEqual({ name: 'Name', type: 'string', column: 'name' });
    expect(res.body.warnings).toEqual([
      'Country.csv: skipped 1 row with the wrong number of fields (line 148)',
      'Country.csv: column "model" generates field ModelField, because Model is reserved by gorm.Model',
    ]);
  });

  it('returns 422 for a CSV with unbalanced quotes', async () => {
    const res = await request(app).post('/api/inspect').attach('file', 'fixtures/BadQuotes.csv');

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      ok: false,
      error:
        'inspect "BadQuotes.csv": parse error on line 3, column 7: extraneous or missing " in quoted-field',
    });
  });
});
