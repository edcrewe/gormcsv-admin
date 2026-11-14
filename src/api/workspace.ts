/**
 * Why the binary is rebuilt: gormcsv can only import models compiled into its binary, because the
 * generated importcsv/models.go (MakeModels) is its model registry. Django is similar: a model must
 * exist in code before `migrate`. So registering a CSV copies it into csv/, regenerates models.go
 * from every registered CSV in a dedicated gormcsv checkout, and runs `go build` to produce a new
 * bin/gormcsv that can import all of them. The new binary is built alongside the old one and only
 * swapped in if the build succeeds. If anything fails, the previous CSVs and models.go are
 * restored, so the workspace always matches its last good binary.
 *
 * How the async parts work: this file runs on the Node server, not in Angular, so it uses plain
 * Promises and async/await rather than Angular's Observables or signals. Each step (copy,
 * inspectcsv, git describe, go build) awaits a child process without blocking Node's event loop, so
 * the server keeps handling other requests during a long build. Registrations must not overlap,
 * because they share one models.go, so exclusive() chains each task onto the previous task's
 * promise. That forms a first-in, first-out queue that works as a lightweight lock. On the client,
 * RegisterModel subscribes to an HttpClient Observable for the long POST, and ModelsPage reads the
 * result through httpResource signals.
 */

import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RegisterResult, WorkspaceBinary, WorkspaceStatus } from '../shared/api-types';
import { CommandError, CommandRunner, errorMessage } from './commands';
import { parseGeneratedModels } from './go-model';
import { cliWarnings } from './inspect';

export interface WorkspaceConfig {
  /** Holds csv/ (registered CSVs) and bin/ (the built gormcsv). */
  dir: string;
  /** A gormcsv source checkout the admin may overwrite, e.g. a detached git worktree. */
  srcDir: string;
  run: CommandRunner;
  /** gormcsv used to generate models.go. Defaults to `gormcsv` on PATH. */
  gormcsvBin?: string;
  goBin?: string;
  gitBin?: string;
  /** A cold build compiles the cgo SQLite driver, which can take minutes. Defaults to 10 min. */
  buildTimeoutMs?: number;
}

export type WorkspaceErrorKind = 'not-ready' | 'rejected' | 'build';

export class WorkspaceError extends Error {
  constructor(
    message: string,
    readonly kind: WorkspaceErrorKind,
    readonly details?: string,
  ) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

const GORMCSV_MODULE = 'module github.com/edcrewe/gormcsv';
const VERSION_FLAG = 'github.com/edcrewe/gormcsv/cmd.Version';
const INSPECT_TIMEOUT_MS = 120_000;
const DETAILS_LINES = 40;

/** The admin's model registry: registered CSVs plus the gormcsv binary built from them. */
export class ModelWorkspace {
  readonly csvDir: string;
  readonly binPath: string;
  /** Copy of the models.go the binary was built from, so status survives checkout updates. */
  private readonly builtModels: string;
  private readonly modelsGo: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: WorkspaceConfig) {
    this.csvDir = join(config.dir, 'csv');
    this.binPath = join(config.dir, 'bin', 'gormcsv');
    this.builtModels = join(config.dir, 'bin', 'models.go');
    this.modelsGo = join(config.srcDir, 'importcsv', 'models.go');
  }

  status(): Promise<WorkspaceStatus> {
    return this.exclusive(() => this.readStatus());
  }

  /** Copies the CSV into the workspace (replacing a same-named one) and rebuilds the binary. */
  register(csvPath: string, filename: string): Promise<RegisterResult> {
    return this.exclusive(async () => {
      const problem = await this.problem();
      if (problem) throw new WorkspaceError(problem, 'not-ready');

      await mkdir(this.csvDir, { recursive: true });
      await mkdir(join(this.config.dir, 'bin'), { recursive: true });
      const replaced = await this.sameModelFiles(filename);
      const backup = {
        models: await readFile(this.modelsGo, 'utf8'),
        files: await Promise.all(
          replaced.map(async (name) => ({ name, data: await readFile(join(this.csvDir, name)) })),
        ),
      };

      try {
        await Promise.all(replaced.map((name) => rm(join(this.csvDir, name))));
        await copyFile(csvPath, join(this.csvDir, filename));
        const warnings = await this.generateModels();
        await this.build();
        return { file: filename, warnings, status: await this.readStatus() };
      } catch (err: unknown) {
        await rm(join(this.csvDir, filename), { force: true });
        await Promise.all(backup.files.map((f) => writeFile(join(this.csvDir, f.name), f.data)));
        await writeFile(this.modelsGo, backup.models);
        throw err;
      }
    });
  }

  private async readStatus(): Promise<WorkspaceStatus> {
    const problem = await this.problem();
    const files = await this.csvFiles();
    const binary = problem ? null : await this.binary();
    const built = binary ? await readFile(this.builtModels, 'utf8').catch(() => '') : '';
    const models = parseGeneratedModels(built);
    return problem
      ? { ready: false, problem, files, models, binary }
      : { ready: true, files, models, binary };
  }

  private async problem(): Promise<string | null> {
    const goMod = await readFile(join(this.config.srcDir, 'go.mod'), 'utf8').catch(() => null);
    if (goMod === null || !goMod.includes(GORMCSV_MODULE)) {
      return `No gormcsv source checkout at ${this.config.srcDir}`;
    }
    return null;
  }

  private async csvFiles(): Promise<string[]> {
    const names = await readdir(this.csvDir).catch(() => [] as string[]);
    return names.filter((name) => name.toLowerCase().endsWith('.csv')).sort();
  }

  /** gormcsv keys models by lower-cased filename, so Users.csv and users.csv are the same model. */
  private async sameModelFiles(filename: string): Promise<string[]> {
    const key = filename.toLowerCase();
    return (await this.csvFiles()).filter((name) => name.toLowerCase() === key);
  }

  private async binary(): Promise<WorkspaceBinary | null> {
    const built = await stat(this.binPath).catch(() => null);
    if (!built) return null;
    const version = await this.config
      .run(this.binPath, ['version'])
      .then(({ stdout }) => stdout.trim().replace(/^gormcsv\s+/, ''))
      .catch(() => 'unknown');
    return { version, builtAt: built.mtime.toISOString() };
  }

  private async generateModels(): Promise<string[]> {
    const { gormcsvBin = 'gormcsv', run } = this.config;
    const hidePaths = (text: string) => text.replaceAll(`${this.csvDir}/`, '');
    try {
      const { stderr } = await run(
        gormcsvBin,
        ['inspectcsv', '--files', this.csvDir, '--output', this.modelsGo],
        { timeoutMs: INSPECT_TIMEOUT_MS },
      );
      return cliWarnings(stderr).map(hidePaths);
    } catch (err: unknown) {
      if (err instanceof CommandError && !err.timedOut && err.exitCode !== null) {
        throw new WorkspaceError(hidePaths(err.cliMessage), 'rejected');
      }
      throw new WorkspaceError('Generating models failed', 'build', errorMessage(err));
    }
  }

  private async build(): Promise<void> {
    const { srcDir, run, goBin = 'go', gitBin = 'git', buildTimeoutMs = 600_000 } = this.config;
    const version = await run(gitBin, ['describe', '--tags', '--always', '--dirty'], {
      cwd: srcDir,
    })
      .then(({ stdout }) => stdout.trim())
      .catch(() => 'devel');
    // Build beside the live binary and swap it in, so a failed build leaves the old one working.
    const next = `${this.binPath}.next`;
    try {
      await run(
        goBin,
        ['build', '-trimpath', '-ldflags', `-X ${VERSION_FLAG}=${version}`, '-o', next, '.'],
        { cwd: srcDir, timeoutMs: buildTimeoutMs },
      );
      await rename(next, this.binPath);
      await copyFile(this.modelsGo, this.builtModels);
    } catch (err: unknown) {
      await rm(next, { force: true });
      const details =
        err instanceof CommandError && err.stderr
          ? err.stderr.trim().split('\n').slice(-DETAILS_LINES).join('\n')
          : errorMessage(err);
      const message =
        err instanceof CommandError && err.timedOut ? 'go build timed out' : 'go build failed';
      throw new WorkspaceError(message, 'build', details);
    }
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
