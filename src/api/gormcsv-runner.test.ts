import { createExecRunner, errorMessage, GormcsvError } from './gormcsv-runner';

// Uses `node` as a stand-in binary so the real execFile path is exercised without needing gormcsv installed.
describe('createExecRunner', () => {
  it('passes args to the binary and returns its output', async () => {
    const run = createExecRunner({ binary: process.execPath });

    const { stdout } = await run(['-e', 'console.log(process.argv.slice(1).join(","))', 'a', 'b']);

    expect(stdout.trim()).toBe('a,b');
  });

  it('rejects with a GormcsvError when the binary does not exist', async () => {
    const run = createExecRunner({ binary: '/nonexistent/gormcsv' });

    const err = await run(['--help']).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GormcsvError);
    expect(err).toMatchObject({ exitCode: null, timedOut: false });
    expect((err as GormcsvError).message).toMatch(/ENOENT/);
  });

  it('reports exit code, stderr and the CLI message on a non-zero exit', async () => {
    const run = createExecRunner({ binary: process.execPath });
    const script = 'console.error("Error: bad csv\\nbad csv"); process.exit(1)';

    const err = await run(['-e', script]).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(GormcsvError);
    expect(err).toMatchObject({
      exitCode: 1,
      timedOut: false,
      stderr: 'Error: bad csv\nbad csv\n',
    });
    expect((err as GormcsvError).cliMessage).toBe('bad csv');
  });

  it('kills commands that exceed the timeout', async () => {
    const run = createExecRunner({ binary: process.execPath, timeoutMs: 100 });

    const err = await run(['-e', 'setTimeout(() => {}, 5000)']).catch((e: unknown) => e);

    expect(err).toMatchObject({ timedOut: true, message: 'gormcsv timed out after 100ms' });
  });
});

describe('GormcsvError.cliMessage', () => {
  it('falls back to the error message when stderr is empty', () => {
    expect(new GormcsvError('spawn failed').cliMessage).toBe('spawn failed');
  });
});

describe('errorMessage', () => {
  it('uses Error.message or stringifies other values', () => {
    expect(errorMessage(new Error('bad'))).toBe('bad');
    expect(errorMessage(42)).toBe('42');
  });
});
