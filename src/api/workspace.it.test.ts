import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createCommandRunner } from './commands';
import { ModelWorkspace } from './workspace';

const exec = promisify(execFile);
const repo = process.env['GORMCSV_SRC_REPO'];

// Opt-in, slow: builds a real gormcsv from a detached worktree of GORMCSV_SRC_REPO.
// Run with `GORMCSV_SRC_REPO=~/projects/gormcsv npm run test:server:it`.
describe.skipIf(!process.env['GORMCSV_IT'] || !repo)(
  'ModelWorkspace with real gormcsv and go',
  () => {
    let root: string;
    let workspace: ModelWorkspace;

    beforeAll(async () => {
      root = await mkdtemp(join(tmpdir(), 'workspace-it-'));
      await exec('git', ['-C', repo!, 'worktree', 'add', '--detach', join(root, 'src'), 'HEAD']);
      workspace = new ModelWorkspace({
        dir: join(root, 'workspace'),
        srcDir: join(root, 'src'),
        run: createCommandRunner(),
        gormcsvBin: process.env['GORMCSV_BIN'],
      });
    });

    afterAll(async () => {
      if (!root) return;
      await exec('git', ['-C', repo!, 'worktree', 'remove', '--force', join(root, 'src')]);
      await rm(root, { recursive: true, force: true });
    });

    // A cold build compiles the cgo SQLite driver.
    it(
      'registers fixtures, builds a binary that knows them, and imports with it',
      { timeout: 600_000 },
      async () => {
        await workspace.register('fixtures/TestTypes.csv', 'TestTypes.csv', { mode: 'identical' });
        const result = await workspace.register('fixtures/Country.csv', 'Country.csv', {
          mode: 'key',
          columns: ['code'],
        });

        expect(result.warnings).toEqual([
          'Country.csv: skipped 1 row with the wrong number of fields (line 148)',
          'Country.csv: column "model" generates field ModelField, because Model is reserved by gorm.Model',
        ]);
        expect(result.status.files).toEqual(['Country.csv', 'TestTypes.csv']);
        expect(result.status.models.map((m) => m.name)).toEqual(['Country', 'TestTypes']);
        // -dirty only when the generated models.go differs from the checkout's; these fixtures match it.
        expect(result.status.binary?.version).toMatch(/^v\d+\.\d+\.\d+/);

        const populated = await workspace.populate({ batchSize: 100, workers: 1 });
        expect(populated).toMatchObject({
          complete: false,
          totals: { inserted: 251, duplicates: 0, rejected: 1 },
          errors: ['Country.csv row 148: record on line 148: wrong number of fields'],
        });

        // Both models have a duplicate rule, so a second import skips every row it loaded.
        const again = await workspace.populate({ batchSize: 100, workers: 1 });
        expect(again.totals).toEqual({ inserted: 0, duplicates: 251, rejected: 1 });

        const { stdout } = await exec(workspace.binPath, [
          'importcsv',
          '--files',
          join(workspace.csvDir, 'TestTypes.csv'),
          '--driver',
          'sqlite',
          '--dsn',
          join(root, 'it.db'),
        ]);
        expect(stdout).toBe('TestTypes: inserted 6, skipped 0 duplicates, rejected 0\n');
      },
    );
  },
);
