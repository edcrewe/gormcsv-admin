import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommandError, createCommandRunner, createExecRunner, errorMessage } from './commands';

// Uses `node` as a stand-in binary so the real execFile path is exercised without needing gormcsv installed.
describe('createExecRunner', () => {
  it('passes args to the binary and returns its output', async () => {
    const run = createExecRunner({ binary: process.execPath });

    const { stdout } = await run(['-e', 'console.log(process.argv.slice(1).join(","))', 'a', 'b']);

    expect(stdout.trim()).toBe('a,b');
  });

  it('rejects with a CommandError when the binary does not exist', async () => {
    const run = createExecRunner({ binary: '/nonexistent/gormcsv' });

    const err = await run(['--help']).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CommandError);
    expect(err).toMatchObject({ exitCode: null, timedOut: false });
    expect((err as CommandError).message).toMatch(/ENOENT/);
  });

  it('reports exit code, stderr and the CLI message on a non-zero exit', async () => {
    const run = createExecRunner({ binary: process.execPath });
    const script = 'console.error("Error: bad csv\\nbad csv"); process.exit(1)';

    const err = await run(['-e', script]).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CommandError);
    expect(err).toMatchObject({
      exitCode: 1,
      timedOut: false,
      stderr: 'Error: bad csv\nbad csv\n',
    });
    expect((err as CommandError).cliMessage).toBe('bad csv');
  });

  it('keeps stdout from a failing command, for partial results', async () => {
    const run = createExecRunner({ binary: process.execPath });
    const script =
      'console.log("X: inserted 1, skipped 0 duplicates, rejected 1"); process.exit(1)';

    const err = await run(['-e', script]).catch((e: unknown) => e);

    expect(err).toMatchObject({
      exitCode: 1,
      stdout: 'X: inserted 1, skipped 0 duplicates, rejected 1\n',
    });
  });

  it('kills commands that exceed the timeout', async () => {
    const run = createExecRunner({ binary: process.execPath, timeoutMs: 100 });

    const err = await run(['-e', 'setTimeout(() => {}, 5000)']).catch((e: unknown) => e);

    expect(err).toMatchObject({
      timedOut: true,
      message: `${process.execPath} timed out after 100ms`,
    });
  });
});

describe('createCommandRunner', () => {
  it('runs in the given working directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cmd-test-'));
    try {
      const run = createCommandRunner();

      const { stdout } = await run(process.execPath, ['-e', 'console.log(process.cwd())'], {
        cwd: dir,
      });

      expect(stdout.trim()).toBe(await realpath(dir));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('names the command in timeout errors', async () => {
    const run = createCommandRunner();

    const err = await run(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], {
      timeoutMs: 100,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CommandError);
    expect(err).toMatchObject({ timedOut: true, exitCode: null });
  });

  it('adds env vars to the server environment for the child only', async () => {
    const run = createCommandRunner();
    const script = 'console.log(process.env.GORMCSV_TEST_VAR, typeof process.env.PATH)';

    const { stdout } = await run(process.execPath, ['-e', script], {
      env: { GORMCSV_TEST_VAR: 'from-env' },
    });

    expect(stdout.trim()).toBe('from-env string');
    expect(process.env['GORMCSV_TEST_VAR']).toBeUndefined();
  });

  it('captures output larger than the execFile 1 MiB default', async () => {
    const run = createCommandRunner();

    const { stdout } = await run(process.execPath, ['-e', 'process.stdout.write("x".repeat(2e6))']);

    expect(stdout).toHaveLength(2_000_000);
  });
});

describe('CommandError.cliMessage', () => {
  it("prefers gormcsv's Error: line over GORM log lines printed before it", () => {
    const stderr =
      '\n2026/11/16 16:13:04 importcsv.go:131\n[error] failed to initialize database\n' +
      'Error: open postgres database: auth failed\n';

    expect(new CommandError('exit 1', stderr, 1).cliMessage).toBe(
      'open postgres database: auth failed',
    );
  });

  it('uses the first non-empty line when there is no Error: line', () => {
    expect(new CommandError('exit 1', '\n  something broke\nmore\n', 1).cliMessage).toBe(
      'something broke',
    );
  });

  it('falls back to the error message when stderr is empty', () => {
    expect(new CommandError('spawn failed').cliMessage).toBe('spawn failed');
  });
});

describe('errorMessage', () => {
  it('uses Error.message or stringifies other values', () => {
    expect(errorMessage(new Error('bad'))).toBe('bad');
    expect(errorMessage(42)).toBe('42');
  });
});
