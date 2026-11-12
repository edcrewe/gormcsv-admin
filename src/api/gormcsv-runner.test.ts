import { createExecRunner, errorMessage } from './gormcsv-runner';

// Uses `node` as a stand-in binary so the real execFile path is exercised without needing gormcsv installed.
describe('createExecRunner', () => {
  it('passes args to the binary and returns its output', async () => {
    const run = createExecRunner({ binary: process.execPath });

    const { stdout } = await run(['-e', 'console.log(process.argv.slice(1).join(","))', 'a', 'b']);

    expect(stdout.trim()).toBe('a,b');
  });

  it('rejects when the binary does not exist', async () => {
    const run = createExecRunner({ binary: '/nonexistent/gormcsv' });

    await expect(run(['--help'])).rejects.toThrow(/ENOENT/);
  });

  it('kills commands that exceed the timeout', async () => {
    const run = createExecRunner({ binary: process.execPath, timeoutMs: 100 });

    await expect(run(['-e', 'setTimeout(() => {}, 5000)'])).rejects.toMatchObject({ killed: true });
  });
});

describe('errorMessage', () => {
  it('uses Error.message or stringifies other values', () => {
    expect(errorMessage(new Error('bad'))).toBe('bad');
    expect(errorMessage(42)).toBe('42');
  });
});
