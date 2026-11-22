import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { CommandError, CommandRunner, RunOptions } from './commands';
import { ModelWorkspace, WorkspaceError, hideDir, modelKey, ruleFlags } from './workspace';

const UPSTREAM_MODELS = '// upstream models.go\npackage importcsv\n';
const VERSION = 'v0.3.1-4-g5ad9de4-dirty';

let root: string;
let srcDir: string;
let dir: string;
let csvIn: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'workspace-test-'));
  srcDir = join(root, 'gormcsv-src');
  dir = join(root, 'workspace');
  csvIn = join(root, 'uploads');
  await mkdir(join(srcDir, 'importcsv'), { recursive: true });
  await mkdir(csvIn);
  await writeFile(join(srcDir, 'go.mod'), 'module github.com/edcrewe/gormcsv\n\ngo 1.25.0\n');
  await writeFile(join(srcDir, 'importcsv', 'models.go'), UPSTREAM_MODELS);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const modelsGo = () => join(srcDir, 'importcsv', 'models.go');
const structName = (file: string) => {
  const stem = basename(file, '.csv');
  return stem[0].toUpperCase() + stem.slice(1).toLowerCase();
};

/** Writes an upload, as multer would, and returns its path. */
async function upload(name: string, content = 'name\nalpha\n'): Promise<string> {
  const path = join(csvIn, name);
  await writeFile(path, content);
  return path;
}

interface FakeOptions {
  /** CSV filenames inspectcsv rejects. */
  reject?: string[];
  /** CSV filenames inspectcsv warns about. */
  warn?: string[];
  buildError?: CommandError;
  buildDelayMs?: number;
  /** Runs after a successful fake build, to break what comes next. */
  afterBuild?: () => Promise<void>;
  describeFails?: boolean;
  /** A built binary whose importcsv predates GORMCSV_DSN. */
  oldImportcsv?: boolean;
  /** What the built binary's importcsv does; defaults to importing every file cleanly. */
  importcsv?: (files: string) => Promise<{ stdout: string; stderr: string }>;
}

/** A `gormcsv importcsv --json` report from [model, inserted, duplicates, rejected] rows. */
function importReport(rows: [string, number, number, number][], errors: string[] = []): string {
  const files = rows.map(([model, inserted, duplicates, rejected]) => ({
    file: `${model}.csv`,
    model,
    inserted,
    duplicates,
    rejected,
  }));
  const sum = (key: 'inserted' | 'duplicates' | 'rejected') =>
    files.reduce((total, f) => total + f[key], 0);
  return JSON.stringify({
    files,
    inserted: sum('inserted'),
    duplicates: sum('duplicates'),
    rejected: sum('rejected'),
    errors,
  });
}

/** Stands in for gormcsv, git and go, using the filesystem the same way they do. */
function fakeTools(options: FakeOptions = {}) {
  const calls: { command: string; args: string[]; options?: RunOptions }[] = [];
  let building = 0;
  let maxConcurrentBuilds = 0;
  let builds = 0;

  const run: CommandRunner = async (command, args, runOptions) => {
    calls.push({ command, args, options: runOptions });
    if (command === 'gormcsv' && args[0] === 'inspectcsv') {
      const csvDir = args[args.indexOf('--files') + 1];
      const output = args[args.indexOf('--output') + 1];
      const files = (await readdir(csvDir)).sort();
      const rejected = files.find((f) => options.reject?.includes(f));
      if (rejected) {
        const line = `inspect "${join(csvDir, rejected)}": parse error on line 2`;
        throw new CommandError('Command failed', `Error: ${line}\n${line}\n`, 1);
      }
      const entries = files.map(
        (f) =>
          `\t\t"${basename(f, '.csv').toLowerCase()}": func() any { return &${structName(f)}{} },`,
      );
      const structs = files.map(
        (f) => `type ${structName(f)} struct {\n\tgorm.Model\n\tName string\n}\n`,
      );
      // Record the exact filenames so tests can tell which CSVs a models.go was generated from.
      const source = [
        `// generated from ${files.join(', ')}`,
        'package importcsv',
        'func MakeModels() ModelFactory {',
        '\treturn NewModelFactory(map[string]func() any{',
        ...entries,
        '\t})',
        '}',
        ...structs,
      ].join('\n');
      await writeFile(output, source);
      const report = {
        output,
        models: files.map((f) => ({
          key: basename(f, '.csv').toLowerCase(),
          name: structName(f),
          fields: [{ name: 'Name', type: 'string', column: 'name' }],
        })),
        skippedRows: Object.fromEntries(
          files.filter((f) => options.warn?.includes(f)).map((f) => [join(csvDir, f), [3]]),
        ),
        warnings: {},
      };
      return { stdout: JSON.stringify(report), stderr: '' };
    }
    if (command === 'git') {
      if (options.describeFails) throw new CommandError('not a git repository', '', 128);
      return { stdout: `${VERSION}\n`, stderr: '' };
    }
    if (command === 'go') {
      building++;
      maxConcurrentBuilds = Math.max(maxConcurrentBuilds, building);
      try {
        if (options.buildDelayMs) await new Promise((r) => setTimeout(r, options.buildDelayMs));
        if (options.buildError) throw options.buildError;
        builds++;
        await writeFile(args[args.indexOf('-o') + 1], `binary build ${builds}`);
        await options.afterBuild?.();
        return { stdout: '', stderr: '' };
      } finally {
        building--;
      }
    }
    if (command.endsWith('/bin/gormcsv') && args[0] === 'version') {
      return { stdout: `gormcsv ${VERSION}\n`, stderr: '' };
    }
    if (command.endsWith('/bin/gormcsv') && args[0] === 'importcsv' && args[1] === '--help') {
      const dsnHelp = options.oldImportcsv ? '' : '; GORMCSV_DSN applies when not given';
      return { stdout: `  -d, --dsn string   database connection string${dsnHelp}\n`, stderr: '' };
    }
    if (command.endsWith('/bin/gormcsv') && args[0] === 'importcsv') {
      const files = args[args.indexOf('--files') + 1];
      if (options.importcsv) return options.importcsv(files);
      const names = files.endsWith('.csv') ? [basename(files)] : (await readdir(files)).sort();
      return { stdout: importReport(names.map((f) => [structName(f), 2, 0, 0])), stderr: '' };
    }
    throw new Error(`unexpected command ${command} ${args.join(' ')}`);
  };
  return { run, calls, stats: () => ({ builds, maxConcurrentBuilds }) };
}

function workspaceWith(tools: ReturnType<typeof fakeTools>) {
  return new ModelWorkspace({ dir, srcDir, run: tools.run });
}

async function workspaceFiles() {
  return (await readdir(join(dir, 'csv')).catch(() => [])).sort();
}

describe('ModelWorkspace.status', () => {
  it('reports a ready, empty workspace before anything is registered', async () => {
    const workspace = workspaceWith(fakeTools());

    expect(await workspace.status()).toEqual({
      ready: true,
      files: [],
      models: [],
      binary: null,
      duplicates: {},
      database: { driver: 'sqlite', dsn: join(dir, 'gormcsv.db') },
    });
  });

  it('reports a problem when the gormcsv checkout is missing', async () => {
    await rm(join(srcDir, 'go.mod'));
    const workspace = workspaceWith(fakeTools());

    expect(await workspace.status()).toEqual({
      ready: false,
      problem: `No gormcsv source checkout at ${srcDir}`,
      files: [],
      models: [],
      binary: null,
      duplicates: {},
      database: { driver: 'sqlite', dsn: join(dir, 'gormcsv.db') },
    });
  });

  it('rejects a checkout of some other Go module', async () => {
    await writeFile(join(srcDir, 'go.mod'), 'module example.com/other\n');

    expect((await workspaceWith(fakeTools()).status()).ready).toBe(false);
  });
});

describe('ModelWorkspace.register', () => {
  it('stores the CSV, regenerates models.go from the csv dir and builds a versioned binary', async () => {
    const tools = fakeTools();
    const workspace = workspaceWith(tools);

    const result = await workspace.register(await upload('users.csv'), 'users.csv');

    expect(await workspaceFiles()).toEqual(['users.csv']);
    expect(tools.calls.map((c) => c.command)).toEqual([
      'gormcsv',
      'git',
      'go',
      `${dir}/bin/gormcsv`,
    ]);
    expect(tools.calls[0].args).toEqual([
      'inspectcsv',
      '--files',
      join(dir, 'csv'),
      '--output',
      modelsGo(),
      '--json',
    ]);
    expect(tools.calls[1]).toMatchObject({
      args: ['describe', '--tags', '--always', '--dirty'],
      options: { cwd: srcDir },
    });
    expect(tools.calls[2]).toMatchObject({
      args: [
        'build',
        '-trimpath',
        '-ldflags',
        `-X github.com/edcrewe/gormcsv/cmd.Version=${VERSION}`,
        '-o',
        join(dir, 'bin', 'gormcsv.next'),
        '.',
      ],
      options: { cwd: srcDir },
    });
    expect(result.file).toBe('users.csv');
    expect(result.warnings).toEqual([]);
    expect(result.status).toMatchObject({
      ready: true,
      files: ['users.csv'],
      models: [
        {
          name: 'Users',
          key: 'users',
          fields: [{ name: 'Name', type: 'string', column: 'name' }],
        },
      ],
      binary: { version: VERSION },
    });
    expect(Date.parse(result.status.binary!.builtAt)).not.toBeNaN();
    expect((await readdir(join(dir, 'bin'))).sort()).toEqual(['gormcsv', 'models.json']);
  });

  it('leaves only the new binary and models after replacing a build', async () => {
    const workspace = workspaceWith(fakeTools());
    await workspace.register(await upload('users.csv'), 'users.csv');

    await workspace.register(await upload('orders.csv'), 'orders.csv');

    expect((await readdir(join(dir, 'bin'))).sort()).toEqual(['gormcsv', 'models.json']);
    expect(await readFile(join(dir, 'bin', 'gormcsv'), 'utf8')).toBe('binary build 2');
  });

  it('builds every registered model into the binary', async () => {
    const workspace = workspaceWith(fakeTools());
    await workspace.register(await upload('users.csv'), 'users.csv');

    const result = await workspace.register(await upload('orders.csv'), 'orders.csv');

    expect(result.status.files).toEqual(['orders.csv', 'users.csv']);
    expect(result.status.models.map((m) => m.name)).toEqual(['Orders', 'Users']);
  });

  it('replaces a CSV for the same model regardless of filename case', async () => {
    const workspace = workspaceWith(fakeTools());
    await workspace.register(await upload('users.csv', 'old\n'), 'users.csv');

    await workspace.register(await upload('Users.csv', 'new\n'), 'Users.csv');

    expect(await workspaceFiles()).toEqual(['Users.csv']);
    expect(await readFile(join(dir, 'csv', 'Users.csv'), 'utf8')).toBe('new\n');
  });

  it('returns inspect warnings without workspace paths', async () => {
    const workspace = workspaceWith(fakeTools({ warn: ['country.csv'] }));

    const result = await workspace.register(await upload('country.csv'), 'country.csv');

    expect(result.warnings).toEqual([
      'country.csv: skipped 1 row with the wrong number of fields (line 3)',
    ]);
  });

  it('falls back to a devel version when git describe fails', async () => {
    const tools = fakeTools({ describeFails: true });

    await workspaceWith(tools).register(await upload('users.csv'), 'users.csv');

    const build = tools.calls.find((c) => c.command === 'go')!;
    expect(build.args).toContain('-X github.com/edcrewe/gormcsv/cmd.Version=devel');
  });

  it('keeps reporting the built models after the checkout models.go changes', async () => {
    const workspace = workspaceWith(fakeTools());
    await workspace.register(await upload('users.csv'), 'users.csv');

    // e.g. `git checkout --detach master` in the worktree restores upstream's models.go.
    await writeFile(modelsGo(), UPSTREAM_MODELS);

    expect((await workspace.status()).models.map((m) => m.name)).toEqual(['Users']);
  });

  it('refuses to register when the checkout is missing, without touching the workspace', async () => {
    await rm(join(srcDir, 'go.mod'));
    const tools = fakeTools();

    const err = await workspaceWith(tools)
      .register(await upload('users.csv'), 'users.csv')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(WorkspaceError);
    expect(err).toMatchObject({ kind: 'not-ready' });
    expect(tools.calls).toEqual([]);
    expect(existsSync(dir)).toBe(false);
  });
});

describe('ModelWorkspace.register rollback', () => {
  async function registeredUsers(tools: ReturnType<typeof fakeTools>) {
    const workspace = workspaceWith(tools);
    await workspace.register(await upload('users.csv', 'original\n'), 'users.csv');
    return {
      workspace,
      before: {
        models: await readFile(modelsGo(), 'utf8'),
        binary: await readFile(join(dir, 'bin', 'gormcsv'), 'utf8'),
        builtModels: await readFile(join(dir, 'bin', 'models.json'), 'utf8'),
        status: await workspace.status(),
      },
    };
  }

  async function expectUnchanged(
    workspace: ModelWorkspace,
    before: Awaited<ReturnType<typeof registeredUsers>>['before'],
  ) {
    expect(await workspaceFiles()).toEqual(['users.csv']);
    expect(await readFile(join(dir, 'csv', 'users.csv'), 'utf8')).toBe('original\n');
    expect(await readFile(modelsGo(), 'utf8')).toBe(before.models);
    expect(await readFile(join(dir, 'bin', 'gormcsv'), 'utf8')).toBe(before.binary);
    expect(await readFile(join(dir, 'bin', 'models.json'), 'utf8')).toBe(before.builtModels);
    for (const leftover of ['gormcsv.next', 'models.json.next', 'gormcsv.prev']) {
      expect(existsSync(join(dir, 'bin', leftover))).toBe(false);
    }
    expect(await workspace.status()).toEqual(before.status);
  }

  it('restores everything when gormcsv rejects the new CSV, reporting it as rejected', async () => {
    const tools = fakeTools({ reject: ['bad.csv'] });
    const { workspace, before } = await registeredUsers(tools);

    const err = await workspace
      .register(await upload('bad.csv'), 'bad.csv')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(WorkspaceError);
    expect(err).toMatchObject({
      kind: 'rejected',
      message: 'inspect "bad.csv": parse error on line 2',
    });
    await expectUnchanged(workspace, before);
  });

  it('restores the replaced CSV and models.go and keeps the old binary when go build fails', async () => {
    const tools = fakeTools();
    const { workspace, before } = await registeredUsers(tools);
    const stderr = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join('\n');
    const failing = fakeTools({ buildError: new CommandError('exit status 1', stderr, 1) });
    const failingWorkspace = new ModelWorkspace({ dir, srcDir, run: failing.run });

    const err = await failingWorkspace
      .register(await upload('Users.csv', 'replacement\n'), 'Users.csv')
      .catch((e: unknown) => e);

    expect(err).toMatchObject({ kind: 'build', message: 'go build failed' });
    const details = (err as WorkspaceError).details!.split('\n');
    expect(details).toHaveLength(40);
    expect(details[0]).toBe('line 21');
    expect(details.at(-1)).toBe('line 60');
    await expectUnchanged(workspace, before);
  });

  it('puts the previous binary back when the swap fails part-way', async () => {
    const { workspace, before } = await registeredUsers(fakeTools());
    // A directory where the live models.json would be kept aside: the binary has been swapped
    // by the time that move fails.
    const blocker = join(dir, 'bin', 'models.json.prev');
    const failing = fakeTools({
      afterBuild: async () => {
        await mkdir(blocker);
        await writeFile(join(blocker, 'x'), '');
      },
    });

    const err = await new ModelWorkspace({ dir, srcDir, run: failing.run })
      .register(await upload('orders.csv'), 'orders.csv')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    await rm(blocker, { recursive: true });
    await expectUnchanged(workspace, before);
  });

  it('puts the previous binary back when the new status cannot be read', async () => {
    const { workspace, before } = await registeredUsers(fakeTools());
    const failing = fakeTools({
      afterBuild: () => writeFile(join(dir, 'duplicates.json'), '{ not json'),
    });

    const err = await new ModelWorkspace({ dir, srcDir, run: failing.run })
      .register(await upload('orders.csv'), 'orders.csv')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SyntaxError);
    await expectUnchanged(workspace, before);
  });

  it('reports a build timeout', async () => {
    const tools = fakeTools({
      buildError: new CommandError('go timed out after 600000ms', '', null, true),
    });

    const err = await workspaceWith(tools)
      .register(await upload('users.csv'), 'users.csv')
      .catch((e: unknown) => e);

    expect(err).toMatchObject({ kind: 'build', message: 'go build timed out' });
    expect(await workspaceFiles()).toEqual([]);
    expect(await readFile(modelsGo(), 'utf8')).toBe(UPSTREAM_MODELS);
  });
});

describe('ModelWorkspace concurrency', () => {
  it('runs registrations one at a time, so builds never overlap', async () => {
    const tools = fakeTools({ buildDelayMs: 30 });
    const workspace = workspaceWith(tools);

    const names = ['a.csv', 'b.csv', 'c.csv'];
    const paths = await Promise.all(names.map((name) => upload(name)));

    // Queued in order without awaiting, so all three are pending at once.
    const results = await Promise.all(names.map((name, i) => workspace.register(paths[i], name)));

    expect(tools.stats()).toEqual({ builds: 3, maxConcurrentBuilds: 1 });
    // First in, first out: each registration sees the ones queued before it.
    expect(results.map((r) => r.status.files)).toEqual([
      ['a.csv'],
      ['a.csv', 'b.csv'],
      ['a.csv', 'b.csv', 'c.csv'],
    ]);
  });

  it('keeps serving later registrations after one fails', async () => {
    const workspace = workspaceWith(fakeTools({ reject: ['bad.csv'] }));

    const [bad, good] = await Promise.allSettled([
      workspace.register(await upload('bad.csv'), 'bad.csv'),
      workspace.register(await upload('good.csv'), 'good.csv'),
    ]);

    expect(bad.status).toBe('rejected');
    expect(good.status).toBe('fulfilled');
    expect(await workspaceFiles()).toEqual(['good.csv']);
  });
});

describe('ModelWorkspace.populate', () => {
  async function built(options: FakeOptions = {}) {
    const tools = fakeTools(options);
    const workspace = workspaceWith(tools);
    await workspace.register(await upload('users.csv'), 'users.csv');
    await workspace.register(await upload('orders.csv'), 'orders.csv');
    tools.calls.length = 0;
    return { tools, workspace };
  }

  const OPTIONS = { batchSize: 500, workers: 2 };

  it('runs the built binary on every registered CSV with the requested options', async () => {
    const { tools, workspace } = await built();

    const result = await workspace.populate(OPTIONS);

    // The first call checks the binary's help for GORMCSV_DSN support; the second imports.
    expect(tools.calls.map((c) => c.args.slice(0, 2))).toEqual([
      ['importcsv', '--help'],
      ['importcsv', '--files'],
    ]);
    expect(tools.calls[1].command).toBe(join(dir, 'bin', 'gormcsv'));
    expect(tools.calls[1].args).toEqual([
      'importcsv',
      '--files',
      join(dir, 'csv'),
      '--driver',
      'sqlite',
      '--batch-size',
      '500',
      '--workers',
      '2',
      '--json',
    ]);
    expect(result).toEqual({
      complete: true,
      files: [
        { model: 'Orders', inserted: 2, duplicates: 0, rejected: 0 },
        { model: 'Users', inserted: 2, duplicates: 0, rejected: 0 },
      ],
      totals: { inserted: 4, duplicates: 0, rejected: 0 },
      errors: [],
      database: { driver: 'sqlite', dsn: join(dir, 'gormcsv.db') },
    });
  });

  it('imports just one registered CSV when asked', async () => {
    const { tools, workspace } = await built();

    const result = await workspace.populate({ ...OPTIONS, file: 'users.csv' });

    expect(tools.calls.at(-1)!.args[2]).toBe(join(dir, 'csv', 'users.csv'));
    expect(result.files.map((f) => f.model)).toEqual(['Users']);
  });

  it('imports into the configured database, showing it with the password masked', async () => {
    const tools = fakeTools();
    const database = {
      driver: 'postgres' as const,
      dsn: 'postgres://ed:s3cret@db:5432/admin?sslmode=disable',
    };
    const workspace = new ModelWorkspace({ dir, srcDir, run: tools.run, database });
    await workspace.register(await upload('users.csv'), 'users.csv');

    const result = await workspace.populate(OPTIONS);

    const importCall = tools.calls.at(-1)!;
    expect(importCall.args[importCall.args.indexOf('--driver') + 1]).toBe('postgres');
    // The DSN travels in the environment, so it never appears in the process list.
    expect(importCall.args).not.toContain('--dsn');
    expect(importCall.args.join(' ')).not.toContain('s3cret');
    expect(importCall.options?.env).toEqual({ GORMCSV_DSN: database.dsn });
    const masked = { driver: 'postgres', dsn: 'postgres://ed:***@db:5432/admin?sslmode=disable' };
    expect(result.database).toEqual(masked);
    expect((await workspace.status()).database).toEqual(masked);
  });

  it('hides the DSN password in import errors', async () => {
    const database = { driver: 'mysql' as const, dsn: 'ed:hunter2@tcp(db:3306)/admin' };
    const tools = fakeTools({
      importcsv: async () => {
        throw new CommandError('exit 1', 'Error: open mysql database: ed:hunter2@tcp refused\n', 1);
      },
    });
    const workspace = new ModelWorkspace({ dir, srcDir, run: tools.run, database });
    await workspace.register(await upload('users.csv'), 'users.csv');

    const err = await workspace.populate(OPTIONS).catch((e: unknown) => e);

    expect(err).toMatchObject({ message: 'open mysql database: ed:***@tcp refused' });
  });

  it('reports the CLI error when a failing importcsv printed log text instead of a report', async () => {
    const { workspace } = await built({
      importcsv: async () => {
        throw new CommandError(
          'exit 1',
          'Error: open postgres database: password authentication failed\n',
          1,
          false,
          '\n2026/11/16 [error] failed to initialize database\n',
        );
      },
    });

    const err = await workspace.populate(OPTIONS).catch((e: unknown) => e);

    expect(err).toMatchObject({
      kind: 'failed',
      message: 'open postgres database: password authentication failed',
    });
  });

  it('returns a partial result, with workspace paths hidden, when importcsv rejects rows', async () => {
    const { workspace } = await built({
      importcsv: async (files) => {
        const error = `${files}/users.csv row 3: record on line 3: wrong number of fields`;
        const stdout = importReport(
          [
            ['Orders', 2, 0, 0],
            ['Users', 1, 1, 1],
          ],
          [error],
        );
        throw new CommandError('exit status 1', `Error: ${error}\n`, 1, false, stdout);
      },
    });

    const result = await workspace.populate(OPTIONS);

    expect(result).toMatchObject({
      complete: false,
      totals: { inserted: 3, duplicates: 1, rejected: 1 },
      errors: ['users.csv row 3: record on line 3: wrong number of fields'],
    });
  });

  it('fails without a partial result when importcsv loaded nothing', async () => {
    const { workspace } = await built({
      importcsv: async () => {
        throw new CommandError(
          'exit status 1',
          'Error: open sqlite database: unable to open database file\n',
          1,
        );
      },
    });

    const err = await workspace.populate(OPTIONS).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(WorkspaceError);
    expect(err).toMatchObject({
      kind: 'failed',
      message: 'open sqlite database: unable to open database file',
    });
  });

  it('asks for a rebuild when the workspace binary is too old to print a JSON report', async () => {
    const { workspace } = await built({
      importcsv: async () => ({
        stdout: 'Users: inserted 2, skipped 0 duplicates, rejected 0\n',
        stderr: '',
      }),
    });

    const err = await workspace.populate(OPTIONS).catch((e: unknown) => e);

    expect(err).toMatchObject({
      kind: 'failed',
      message:
        'gormcsv importcsv did not print a JSON report; it may be too old; register a model to rebuild it',
    });
  });

  it('reports the CLI error when importcsv fails with a JSON report that loaded nothing', async () => {
    const { workspace } = await built({
      importcsv: async (files) => {
        const error = `${files}/other.csv: no model registered for "other"`;
        throw new CommandError(
          'exit status 1',
          `Error: ${error}\n`,
          1,
          false,
          importReport([], [error]),
        );
      },
    });

    const err = await workspace.populate(OPTIONS).catch((e: unknown) => e);

    expect(err).toMatchObject({
      kind: 'failed',
      message: 'other.csv: no model registered for "other"',
    });
  });

  it('reports a timeout', async () => {
    const { workspace } = await built({
      importcsv: async () => {
        throw new CommandError('timed out', '', null, true);
      },
    });

    const err = await workspace.populate(OPTIONS).catch((e: unknown) => e);

    expect(err).toMatchObject({ kind: 'failed', message: 'importcsv timed out' });
  });

  it('refuses a binary that would ignore GORMCSV_DSN, rather than import somewhere else', async () => {
    const { tools, workspace } = await built({ oldImportcsv: true });

    const err = await workspace.populate(OPTIONS).catch((e: unknown) => e);

    expect(err).toMatchObject({ kind: 'not-ready', message: expect.stringMatching(/GORMCSV_DSN/) });
    expect(tools.calls.filter((c) => c.args[0] === 'importcsv' && c.args[1] !== '--help')).toEqual(
      [],
    );
  });

  it('checks the binary help once per build', async () => {
    const { tools, workspace } = await built();

    await workspace.populate(OPTIONS);
    await workspace.populate(OPTIONS);
    const helpCalls = () => tools.calls.filter((c) => c.args[1] === '--help').length;
    expect(helpCalls()).toBe(1);

    await workspace.register(await upload('users.csv'), 'users.csv');
    await workspace.populate(OPTIONS);
    expect(helpCalls()).toBe(2);
  });

  it('refuses before the first build', async () => {
    const tools = fakeTools();

    const err = await workspaceWith(tools)
      .populate(OPTIONS)
      .catch((e: unknown) => e);

    expect(err).toMatchObject({ kind: 'not-ready' });
    expect(tools.calls).toEqual([]);
  });

  it('refuses a file that is not registered, including path tricks', async () => {
    const { tools, workspace } = await built();

    for (const file of ['missing.csv', '../users.csv', 'USERS.csv']) {
      const err = await workspace.populate({ ...OPTIONS, file }).catch((e: unknown) => e);
      expect(err).toMatchObject({ kind: 'not-found', message: `${file} is not a registered CSV` });
    }
    expect(tools.calls).toEqual([]);
  });

  it('waits for a queued registration to finish building before importing', async () => {
    const tools = fakeTools({ buildDelayMs: 40 });
    const workspace = workspaceWith(tools);
    await workspace.register(await upload('users.csv'), 'users.csv');
    tools.calls.length = 0;

    const path = await upload('orders.csv');
    const registering = workspace.register(path, 'orders.csv');
    const importing = workspace.populate(OPTIONS);
    const [, result] = await Promise.all([registering, importing]);

    expect(tools.calls.map((c) => c.args.slice(0, 2).join(' '))).toEqual([
      expect.stringMatching(/^inspectcsv/),
      expect.stringMatching(/^describe/),
      expect.stringMatching(/^build/),
      'version',
      'importcsv --help',
      'importcsv --files',
    ]);
    expect(result.files.map((f) => f.model)).toEqual(['Orders', 'Users']);
  });
});

describe('ModelWorkspace duplicate rules', () => {
  const inspectArgs = (tools: ReturnType<typeof fakeTools>) =>
    tools.calls.filter((c) => c.args[0] === 'inspectcsv').at(-1)!.args;

  it('applies a key rule as --key and saves it for the model', async () => {
    const tools = fakeTools();
    const workspace = workspaceWith(tools);

    const result = await workspace.register(await upload('Orders.csv'), 'Orders.csv', {
      mode: 'key',
      columns: ['order_id', 'line'],
    });

    expect(inspectArgs(tools)).toContain('--key');
    expect(inspectArgs(tools)).toContain('orders=order_id+line');
    expect(result.status.duplicates).toEqual({
      orders: { mode: 'key', columns: ['order_id', 'line'] },
    });
    expect(JSON.parse(await readFile(join(dir, 'duplicates.json'), 'utf8'))).toEqual(
      result.status.duplicates,
    );
  });

  it('keeps every model rule on later registrations, and a rule omitted on re-register', async () => {
    const tools = fakeTools();
    const workspace = workspaceWith(tools);
    await workspace.register(await upload('users.csv'), 'users.csv', { mode: 'identical' });
    await workspace.register(await upload('orders.csv'), 'orders.csv', {
      mode: 'key',
      columns: ['id'],
    });

    const result = await workspace.register(await upload('users.csv'), 'users.csv');

    expect(inspectArgs(tools)).toEqual([
      'inspectcsv',
      '--files',
      join(dir, 'csv'),
      '--output',
      modelsGo(),
      '--key',
      'orders=id',
      '--dedupe',
      'users',
      '--json',
    ]);
    expect(result.status.duplicates).toEqual({
      orders: { mode: 'key', columns: ['id'] },
      users: { mode: 'identical' },
    });
  });

  it('removes a model rule when set back to allow', async () => {
    const tools = fakeTools();
    const workspace = workspaceWith(tools);
    await workspace.register(await upload('users.csv'), 'users.csv', { mode: 'identical' });

    const result = await workspace.register(await upload('users.csv'), 'users.csv', {
      mode: 'allow',
    });

    expect(result.status.duplicates).toEqual({});
    expect(inspectArgs(tools)).not.toContain('--dedupe');
  });

  it('restores the previous rules when the build fails', async () => {
    const good = fakeTools();
    const workspace = workspaceWith(good);
    await workspace.register(await upload('users.csv'), 'users.csv', { mode: 'identical' });
    const failing = new ModelWorkspace({
      dir,
      srcDir,
      run: fakeTools({ buildError: new CommandError('exit status 1', 'boom', 1) }).run,
    });

    await failing
      .register(await upload('users.csv'), 'users.csv', { mode: 'key', columns: ['name'] })
      .catch(() => undefined);

    expect((await workspace.status()).duplicates).toEqual({ users: { mode: 'identical' } });
  });
});

describe('hideDir', () => {
  it('removes the directory from paths with either separator', () => {
    expect(hideDir('/ws/csv/users.csv row 3: bad', '/ws/csv')).toBe('users.csv row 3: bad');
    expect(hideDir('open "C:\\ws\\csv\\users.csv": denied', 'C:\\ws\\csv')).toBe(
      'open "users.csv": denied',
    );
  });

  it('leaves other paths, and the directory without a separator, alone', () => {
    expect(hideDir('/ws/csv-old/a.csv and /ws/csv', '/ws/csv')).toBe(
      '/ws/csv-old/a.csv and /ws/csv',
    );
  });
});

describe('modelKey and ruleFlags', () => {
  it('derives gormcsv model keys from filenames', () => {
    expect(modelKey('Order-Item.CSV')).toBe('order-item');
    expect(modelKey('users.csv')).toBe('users');
  });

  it('turns rules into sorted gormcsv flags, skipping allow', () => {
    expect(
      ruleFlags({
        zebra: { mode: 'identical' },
        apple: { mode: 'key', columns: ['a', 'b'] },
        plain: { mode: 'allow' },
      }),
    ).toEqual([
      ['--key', 'apple=a+b'],
      ['--dedupe', 'zebra'],
    ]);
  });
});
