import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { CommandError, CommandRunner, RunOptions } from './commands';
import { ModelWorkspace, WorkspaceError } from './workspace';

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
  describeFails?: boolean;
  /** What the built binary's importcsv does; defaults to importing every file cleanly. */
  importcsv?: (files: string) => Promise<{ stdout: string; stderr: string }>;
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
      const stderr = files
        .filter((f) => options.warn?.includes(f))
        .map(
          (f) =>
            `warning: ${join(csvDir, f)}: skipped 1 row with the wrong number of fields (line 3)\n`,
        )
        .join('');
      return { stdout: `generated ${output}\n`, stderr };
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
        return { stdout: '', stderr: '' };
      } finally {
        building--;
      }
    }
    if (command.endsWith('/bin/gormcsv') && args[0] === 'version') {
      return { stdout: `gormcsv ${VERSION}\n`, stderr: '' };
    }
    if (command.endsWith('/bin/gormcsv') && args[0] === 'importcsv') {
      const files = args[args.indexOf('--files') + 1];
      if (options.importcsv) return options.importcsv(files);
      const names = files.endsWith('.csv') ? [basename(files)] : (await readdir(files)).sort();
      const stdout = names
        .map((f) => `${structName(f)}: inserted 2, skipped 0 duplicates, rejected 0\n`)
        .join('');
      return { stdout, stderr: '' };
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

    expect(await workspace.status()).toEqual({ ready: true, files: [], models: [], binary: null });
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
      models: [{ name: 'Users', key: 'users', fields: [{ name: 'Name', type: 'string' }] }],
      binary: { version: VERSION },
    });
    expect(Date.parse(result.status.binary!.builtAt)).not.toBeNaN();
    expect(existsSync(join(dir, 'bin', 'gormcsv.next'))).toBe(false);
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
    expect(existsSync(join(dir, 'bin', 'gormcsv.next'))).toBe(false);
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

    expect(tools.calls).toHaveLength(1);
    expect(tools.calls[0].command).toBe(join(dir, 'bin', 'gormcsv'));
    expect(tools.calls[0].args).toEqual([
      'importcsv',
      '--files',
      join(dir, 'csv'),
      '--driver',
      'sqlite',
      '--dsn',
      join(dir, 'gormcsv.db'),
      '--batch-size',
      '500',
      '--workers',
      '2',
    ]);
    expect(result).toEqual({
      complete: true,
      files: [
        { model: 'Orders', inserted: 2, duplicates: 0, rejected: 0 },
        { model: 'Users', inserted: 2, duplicates: 0, rejected: 0 },
      ],
      totals: { inserted: 4, duplicates: 0, rejected: 0 },
      errors: [],
      database: join(dir, 'gormcsv.db'),
    });
  });

  it('imports just one registered CSV when asked', async () => {
    const { tools, workspace } = await built();

    const result = await workspace.populate({ ...OPTIONS, file: 'users.csv' });

    expect(tools.calls[0].args[2]).toBe(join(dir, 'csv', 'users.csv'));
    expect(result.files.map((f) => f.model)).toEqual(['Users']);
  });

  it('writes to a configured database path', async () => {
    const tools = fakeTools();
    const workspace = new ModelWorkspace({
      dir,
      srcDir,
      run: tools.run,
      databasePath: '/data/x.db',
    });
    await workspace.register(await upload('users.csv'), 'users.csv');

    const result = await workspace.populate(OPTIONS);

    expect(tools.calls.at(-1)!.args).toContain('/data/x.db');
    expect(result.database).toBe('/data/x.db');
  });

  it('returns a partial result, with workspace paths hidden, when importcsv rejects rows', async () => {
    const { workspace } = await built({
      importcsv: async (files) => {
        const error = `${files}/users.csv row 3: record on line 3: wrong number of fields`;
        throw new CommandError(
          'exit status 1',
          `Error: ${error}\n${error}\n`,
          1,
          false,
          'Orders: inserted 2, skipped 0 duplicates, rejected 0\n' +
            'Users: inserted 1, skipped 1 duplicates, rejected 1\n',
        );
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

  it('reports a timeout', async () => {
    const { workspace } = await built({
      importcsv: async () => {
        throw new CommandError('timed out', '', null, true);
      },
    });

    const err = await workspace.populate(OPTIONS).catch((e: unknown) => e);

    expect(err).toMatchObject({ kind: 'failed', message: 'importcsv timed out' });
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

    expect(tools.calls.map((c) => c.args[0])).toEqual([
      'inspectcsv',
      'describe',
      'build',
      'version',
      'importcsv',
    ]);
    expect(result.files.map((f) => f.model)).toEqual(['Orders', 'Users']);
  });
});
