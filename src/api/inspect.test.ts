import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { createApiRouter } from './api-router';
import { CommandError, GormcsvRunner } from './commands';
import { cliWarnings, safeCsvName } from './inspect';

const FIXTURE = 'fixtures/TestTypes.csv';
const GOLDEN = 'fixtures/inspect-golden.models.go';

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

/** Stands in for gormcsv: records the uploaded CSV it was given and writes the golden models.go. */
function fakeInspect() {
  const seen: { args: string[]; csv: string }[] = [];
  const runner = vi.fn<GormcsvRunner>(async (args) => {
    seen.push({ args, csv: await readFile(argValue(args, '--files'), 'utf8') });
    await writeFile(argValue(args, '--output'), await readFile(GOLDEN, 'utf8'));
    return { stdout: 'generated models.go\n', stderr: '' };
  });
  return { runner, seen };
}

/** Cleanup runs on response close, just after supertest resolves. */
async function expectTempRootEmpty() {
  await vi.waitFor(async () => expect(await readdir(tempRoot)).toEqual([]));
}

describe('POST /api/inspect', () => {
  it('runs inspectcsv on the uploaded CSV and returns the parsed models and source', async () => {
    const { runner, seen } = fakeInspect();

    const res = await request(appWith(runner)).post('/api/inspect').attach('file', FIXTURE);

    expect(res.status).toBe(200);
    expect(res.body.file).toBe('TestTypes.csv');
    expect(res.body.models.map((m: { name: string }) => m.name)).toEqual([
      'OrderItem',
      'TestTypes',
    ]);
    expect(res.body.source).toBe(await readFile(GOLDEN, 'utf8'));
    expect(res.body.warnings).toEqual([]);

    const [{ args, csv }] = seen;
    expect(args[0]).toBe('inspectcsv');
    expect(argValue(args, '--files')).toMatch(/gormcsv-inspect-[^/]+\/TestTypes\.csv$/);
    expect(dirname(argValue(args, '--output'))).toBe(dirname(argValue(args, '--files')));
    expect(dirname(dirname(argValue(args, '--files')))).toBe(tempRoot);
    expect(csv).toBe(await readFile(FIXTURE, 'utf8'));
    await expectTempRootEmpty();
  });

  it('returns CLI warnings with the temp path replaced by the filename', async () => {
    const runner = vi.fn<GormcsvRunner>(async (args) => {
      const path = argValue(args, '--files');
      await writeFile(argValue(args, '--output'), await readFile(GOLDEN, 'utf8'));
      return {
        stdout: 'generated models.go\n',
        stderr: `warning: ${path}: skipped 1 row with the wrong number of fields (line 148)\n`,
      };
    });

    const res = await request(appWith(runner)).post('/api/inspect').attach('file', FIXTURE);

    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual([
      'TestTypes.csv: skipped 1 row with the wrong number of fields (line 148)',
    ]);
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
    const runner = vi.fn<GormcsvRunner>().mockResolvedValue({ stdout: '', stderr: '' });

    const res = await request(appWith(runner)).post('/api/inspect').attach('file', FIXTURE);

    expect(res.status).toBe(500);
    expect(res.body.details).toMatch(/ENOENT/);
    await expectTempRootEmpty();
  });
});

describe('cliWarnings', () => {
  it('keeps only "warning:" lines, without the prefix', () => {
    const stderr =
      'warning: a.csv: skipped 1 row (line 3)\nnoise\n\nwarning: b.csv: skipped 2 rows\n';

    expect(cliWarnings(stderr)).toEqual(['a.csv: skipped 1 row (line 3)', 'b.csv: skipped 2 rows']);
  });

  it('returns nothing for empty stderr', () => {
    expect(cliWarnings('')).toEqual([]);
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
