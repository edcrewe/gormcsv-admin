import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { createApiRouter } from './api-router';
import { CommandError, GormcsvRunner } from './commands';
import { safeCsvName } from './upload';

const FIXTURE = 'fixtures/TestTypes.csv';
const SOURCE = 'package importcsv\n\ntype TestTypes struct{}\n';

/** A `gormcsv inspectcsv --json` report, with optional overrides. */
function report(extra: object = {}) {
  return JSON.stringify({
    output: 'models.go',
    models: [
      {
        key: 'testtypes',
        name: 'TestTypes',
        fields: [{ name: 'Wordcol', type: 'string', column: 'wordcol' }],
      },
    ],
    skippedRows: {},
    warnings: {},
    ...extra,
  });
}

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'inspect-test-'));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

function appWith(runner: GormcsvRunner, maxUploadBytes?: number) {
  const app = express();
  app.use('/api', createApiRouter({ runner, inspect: { tempRoot, maxUploadBytes } }));
  return app;
}

function argValue(args: string[], flag: string): string {
  return args[args.indexOf(flag) + 1];
}

/** Stands in for gormcsv: records the uploaded CSV, writes models.go and prints a JSON report. */
function fakeInspect() {
  const seen: { args: string[]; csv: string }[] = [];
  const runner = vi.fn<GormcsvRunner>(async (args) => {
    seen.push({ args, csv: await readFile(argValue(args, '--files'), 'utf8') });
    await writeFile(argValue(args, '--output'), SOURCE);
    return { stdout: report(), stderr: '' };
  });
  return { runner, seen };
}

/** Cleanup runs on response close, just after supertest resolves. */
async function expectTempRootEmpty() {
  await vi.waitFor(async () => expect(await readdir(tempRoot)).toEqual([]));
}

describe('POST /api/inspect', () => {
  it('runs inspectcsv --json on the uploaded CSV and returns its models and source', async () => {
    const { runner, seen } = fakeInspect();

    const res = await request(appWith(runner)).post('/api/inspect').attach('file', FIXTURE);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      file: 'TestTypes.csv',
      models: [
        {
          key: 'testtypes',
          name: 'TestTypes',
          fields: [{ name: 'Wordcol', type: 'string', column: 'wordcol' }],
        },
      ],
      source: SOURCE,
      warnings: [],
    });

    const [{ args, csv }] = seen;
    expect(args[0]).toBe('inspectcsv');
    expect(args.at(-1)).toBe('--json');
    expect(argValue(args, '--files')).toMatch(/gormcsv-upload-[^/]+\/TestTypes\.csv$/);
    expect(dirname(argValue(args, '--output'))).toBe(dirname(argValue(args, '--files')));
    expect(dirname(dirname(argValue(args, '--files')))).toBe(tempRoot);
    expect(csv).toBe(await readFile(FIXTURE, 'utf8'));
    await expectTempRootEmpty();
  });

  it('formats skipped rows and warnings from the report, showing the filename not the temp path', async () => {
    const runner = vi.fn<GormcsvRunner>(async (args) => {
      const path = argValue(args, '--files');
      await writeFile(argValue(args, '--output'), SOURCE);
      return {
        stdout: report({
          skippedRows: { [path]: [148] },
          warnings: { [path]: ['column "model" generates field ModelField'] },
        }),
        stderr: '',
      };
    });

    const res = await request(appWith(runner)).post('/api/inspect').attach('file', FIXTURE);

    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual([
      'TestTypes.csv: skipped 1 row with the wrong number of fields (line 148)',
      'TestTypes.csv: column "model" generates field ModelField',
    ]);
  });

  it('returns 500 when gormcsv is too old to print a JSON report', async () => {
    const runner = vi.fn<GormcsvRunner>(async (args) => {
      await writeFile(argValue(args, '--output'), SOURCE);
      return { stdout: 'generated models.go\n', stderr: '' };
    });

    const res = await request(appWith(runner)).post('/api/inspect').attach('file', FIXTURE);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      ok: false,
      error: 'Inspect failed',
      details: 'gormcsv inspectcsv did not print a JSON report; it may be too old',
    });
    await expectTempRootEmpty();
  });

  it('reduces a path-traversal filename to its basename inside the temp dir', async () => {
    const { runner, seen } = fakeInspect();

    const res = await request(appWith(runner))
      .post('/api/inspect')
      .attach('file', FIXTURE, { filename: '../../etc/evil.csv' });

    expect(res.status).toBe(200);
    expect(res.body.file).toBe('evil.csv');
    expect(dirname(dirname(argValue(seen[0].args, '--files')))).toBe(tempRoot);
    expect(existsSync(join(tempRoot, '..', 'etc', 'evil.csv'))).toBe(false);
  });

  it.each(['data.txt', 'no-extension', '.csv', 'semi;colon.csv', 'tab\tname.csv'])(
    'rejects %j with 400 without running the CLI',
    async (filename) => {
      const { runner } = fakeInspect();

      const res = await request(appWith(runner))
        .post('/api/inspect')
        .attach('file', FIXTURE, { filename });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ ok: false, error: 'Upload a .csv file with a plain filename' });
      expect(runner).not.toHaveBeenCalled();
      await expectTempRootEmpty();
    },
  );

  it('rejects a request with no file', async () => {
    const { runner } = fakeInspect();

    const res = await request(appWith(runner)).post('/api/inspect').field('other', 'x');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No file uploaded/);
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects files over the size limit with 413 and cleans up the partial upload', async () => {
    const { runner } = fakeInspect();

    const res = await request(appWith(runner, 100)).post('/api/inspect').attach('file', FIXTURE);

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ ok: false, error: 'File is too large' });
    expect(runner).not.toHaveBeenCalled();
    await expectTempRootEmpty();
  });

  it('returns 422 with the CLI message, hiding the temp path, when gormcsv rejects the CSV', async () => {
    const runner = vi.fn<GormcsvRunner>(async (args) => {
      const path = argValue(args, '--files');
      const line = `inspect "${path}": record on line 148: wrong number of fields`;
      throw new CommandError('Command failed', `Error: ${line}\n${line}\n`, 1);
    });

    const res = await request(appWith(runner)).post('/api/inspect').attach('file', FIXTURE);

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      ok: false,
      error: 'inspect "TestTypes.csv": record on line 148: wrong number of fields',
    });
    await expectTempRootEmpty();
  });

  it('returns 500 when the CLI times out', async () => {
    const runner = vi
      .fn<GormcsvRunner>()
      .mockRejectedValue(new CommandError('gormcsv timed out after 30000ms', '', null, true));

    const res = await request(appWith(runner)).post('/api/inspect').attach('file', FIXTURE);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      ok: false,
      error: 'Inspect failed',
      details: 'gormcsv timed out after 30000ms',
    });
    await expectTempRootEmpty();
  });

  it('returns 500 when the CLI succeeds but writes no models file', async () => {
    const runner = vi.fn<GormcsvRunner>().mockResolvedValue({ stdout: report(), stderr: '' });

    const res = await request(appWith(runner)).post('/api/inspect').attach('file', FIXTURE);

    expect(res.status).toBe(500);
    expect(res.body.details).toMatch(/ENOENT/);
    await expectTempRootEmpty();
  });
});

describe('safeCsvName', () => {
  it.each([
    ['TestTypes.csv', 'TestTypes.csv'],
    ['order-item.CSV', 'order-item.CSV'],
    ['my file.csv', 'my file.csv'],
    ['../../x.csv', 'x.csv'],
    ['C:\\Users\\ed\\x.csv', 'x.csv'],
    ['-rf.csv', null],
    ['x.csv.exe', null],
    [`${'a'.repeat(101)}.csv`, null],
  ])('%j -> %j', (input, expected) => {
    expect(safeCsvName(input)).toBe(expected);
  });
});
