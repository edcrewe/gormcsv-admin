import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createCommandRunner } from './commands';
import { ModelWorkspace } from './workspace';

const exec = promisify(execFile);
const repo = process.env['GORMCSV_SRC_REPO'];

// Opt-in, like workspace.it.test.ts: the README's samples walkthrough, built and imported for real.
describe.skipIf(!process.env['GORMCSV_IT'] || !repo)('samples/ with real gormcsv and go', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'samples-it-'));
    await exec('git', ['-C', repo!, 'worktree', 'add', '--detach', join(root, 'src'), 'HEAD']);
  });

  afterAll(async () => {
    if (!root) return;
    await exec('git', ['-C', repo!, 'worktree', 'remove', '--force', join(root, 'src')]);
    await rm(root, { recursive: true, force: true });
  });

  it(
    'registers each sample with its duplicate rule; a second import skips everything',
    {
      timeout: 600_000,
    },
    async () => {
      const workspace = new ModelWorkspace({
        dir: join(root, 'workspace'),
        srcDir: join(root, 'src'),
        run: createCommandRunner(),
        gormcsvBin: process.env['GORMCSV_BIN'],
      });
      await workspace.register('samples/products.csv', 'products.csv', {
        mode: 'key',
        columns: ['sku'],
      });
      await workspace.register('samples/order-lines.csv', 'order-lines.csv', {
        mode: 'key',
        columns: ['order_id', 'line'],
      });
      const result = await workspace.register('samples/readings.csv', 'readings.csv', {
        mode: 'identical',
      });
      expect(result.warnings).toEqual([]);
      expect(result.status.models.map((m) => m.name)).toEqual([
        'OrderLines',
        'Products',
        'Readings',
      ]);

      // readings.csv repeats its first reading, so even the first import skips one row.
      const first = await workspace.populate({ batchSize: 100, workers: 1 });
      expect(first).toMatchObject({
        complete: true,
        totals: { inserted: 17, duplicates: 1, rejected: 0 },
      });
      const again = await workspace.populate({ batchSize: 100, workers: 1 });
      expect(again.totals).toEqual({ inserted: 0, duplicates: 18, rejected: 0 });
    },
  );
});
