import { ChildProcess, execFile, spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const BIN = 'bin/gormcsv-admin.mjs';

async function runBin(script: string, args: string[]) {
  return exec(process.execPath, [script, ...args]).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    (err: { code: number; stdout: string; stderr: string }) => err,
  );
}

describe('gormcsv-admin bin', () => {
  it('prints usage for --help', async () => {
    const { code, stdout } = await runBin(BIN, ['--help']);

    expect(code).toBe(0);
    expect(stdout).toContain('Usage: gormcsv-admin [--port <port>] [--host <host>]');
  });

  it.each([
    [['--port', 'abc'], '--port must be a number'],
    [['--nope'], "Unknown option '--nope'"],
  ])('exits 2 for bad arguments %j', async (args, message) => {
    const { code, stderr } = await runBin(BIN, args);

    expect(code).toBe(2);
    expect(stderr).toContain(message);
  });

  it('says to build first when there is no built server', async () => {
    const root = await mkdtemp(join(tmpdir(), 'bin-test-'));
    try {
      await mkdir(join(root, 'bin'));
      await copyFile(BIN, join(root, 'bin', 'gormcsv-admin.mjs'));

      const { code, stderr } = await runBin(join(root, 'bin', 'gormcsv-admin.mjs'), []);

      expect(code).toBe(1);
      expect(stderr).toContain('Run `npm run build`');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // Needs `npm run build`; CI builds before the integration job, and locally the build usually exists.
  it.skipIf(!existsSync('dist/gormcsv-admin/server/server.mjs'))(
    'starts the server on the given port and stops it on SIGINT with exit 130',
    { timeout: 20_000 },
    async () => {
      const port = String(40_000 + Math.floor(Math.random() * 10_000));
      const child: ChildProcess = spawn(process.execPath, [BIN, '--port', port], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      try {
        let status = 0;
        for (let i = 0; i < 50 && status !== 200; i++) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          status = await fetch(`http://127.0.0.1:${port}/import`).then(
            (res) => res.status,
            () => 0,
          );
        }
        expect(status).toBe(200);
      } finally {
        const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
        child.kill('SIGINT');
        expect(await exited).toBe(130);
      }
    },
  );
});
