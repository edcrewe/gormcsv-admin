/**
 * Why the binary is rebuilt: gormcsv can only import models compiled into its binary, because the
 * generated importcsv/models.go (MakeModels) is its model registry. Django is similar: a model must
 * exist in code before `migrate`. So registering a CSV copies it into csv/, regenerates models.go
 * from every registered CSV in a dedicated gormcsv checkout, and runs `go build` to produce a new
 * bin/gormcsv that can import all of them. The new binary and the models.json describing it are
 * built alongside the old pair and swapped in together only if the build succeeds. If anything
 * fails, the previous CSVs, models.go and binary are restored, so the workspace always matches its
 * last good binary.
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
import type {
  DuplicateRule,
  GoModel,
  ImportRequest,
  ImportResult,
  RegisterResult,
  WorkspaceBinary,
  WorkspaceStatus,
} from '../shared/api-types';
import { CommandError, CommandRunner, errorMessage } from './commands';
import { DatabaseConfig, databaseInfo, scrub } from './database';
import {
  ReportError,
  parseImportReport,
  parseInspectReport,
  reportFiles,
  reportModels,
  reportWarnings,
} from './gormcsv-json';

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
  /** Database that imports write to. Defaults to SQLite at gormcsv.db in the workspace dir. */
  database?: DatabaseConfig;
  /** Large CSVs take a while to load. Defaults to 30 min. */
  importTimeoutMs?: number;
}

export type WorkspaceErrorKind = 'not-ready' | 'not-found' | 'rejected' | 'build' | 'failed';

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

/** A new binary and models.json moved into place, with the previous pair kept until confirmed. */
interface Swap {
  undo(): Promise<void>;
  discardPrevious(): Promise<void>;
}

/**
 * Removes dir and the separator after it from paths in text. gormcsv prints paths with the
 * platform's separator, so both / and \ are matched.
 */
export function hideDir(text: string, dir: string): string {
  return text.replaceAll(`${dir}/`, '').replaceAll(`${dir}\\`, '');
}

/** The admin's model registry: registered CSVs plus the gormcsv binary built from them. */
export class ModelWorkspace {
  readonly csvDir: string;
  readonly binPath: string;
  /** The models the binary was built with, as JSON, so status survives checkout updates. */
  private readonly builtModels: string;
  private readonly modelsGo: string;
  /** Duplicate rules per model key, applied every time models.go is regenerated. */
  private readonly rulesPath: string;
  readonly database: DatabaseConfig;
  private queue: Promise<unknown> = Promise.resolve();
  private envDsnCheck?: { builtAt: number; supported: boolean };

  constructor(private readonly config: WorkspaceConfig) {
    this.database = config.database ?? { driver: 'sqlite', dsn: join(config.dir, 'gormcsv.db') };
    this.csvDir = join(config.dir, 'csv');
    this.binPath = join(config.dir, 'bin', 'gormcsv');
    this.builtModels = join(config.dir, 'bin', 'models.json');
    this.modelsGo = join(config.srcDir, 'importcsv', 'models.go');
    this.rulesPath = join(config.dir, 'duplicates.json');
  }

  /** What a build produces, swapped into place together. */
  private get artifacts(): string[] {
    return [this.binPath, this.builtModels];
  }

  status(): Promise<WorkspaceStatus> {
    return this.exclusive(() => this.readStatus());
  }

  /**
   * Copies the CSV into the workspace (replacing a same-named one) and rebuilds the binary.
   * duplicates sets how this model treats rows already in its table; omit it to keep the
   * model's current rule.
   */
  register(csvPath: string, filename: string, duplicates?: DuplicateRule): Promise<RegisterResult> {
    return this.exclusive(async () => {
      const problem = await this.problem();
      if (problem) throw new WorkspaceError(problem, 'not-ready');

      await mkdir(this.csvDir, { recursive: true });
      await mkdir(join(this.config.dir, 'bin'), { recursive: true });
      const replaced = await this.sameModelFiles(filename);
      const rules = await this.readRules();
      const backup = {
        rules: structuredClone(rules),
        models: await readFile(this.modelsGo, 'utf8'),
        files: await Promise.all(
          replaced.map(async (name) => ({ name, data: await readFile(join(this.csvDir, name)) })),
        ),
      };
      let swap: Swap | undefined;

      try {
        await Promise.all(replaced.map((name) => rm(join(this.csvDir, name))));
        await copyFile(csvPath, join(this.csvDir, filename));
        const key = modelKey(filename);
        if (duplicates?.mode === 'allow') delete rules[key];
        else if (duplicates) rules[key] = duplicates;
        await this.writeRules(rules);
        const { warnings, models } = await this.generateModels(rules);
        await this.build(models);
        swap = await this.swapIn();
        const status = await this.readStatus();
        await swap.discardPrevious();
        return { file: filename, warnings, status };
      } catch (err: unknown) {
        await swap?.undo();
        await Promise.all(this.artifacts.map((path) => rm(`${path}.next`, { force: true })));
        await rm(join(this.csvDir, filename), { force: true });
        await Promise.all(backup.files.map((f) => writeFile(join(this.csvDir, f.name), f.data)));
        await writeFile(this.modelsGo, backup.models);
        await this.writeRules(backup.rules);
        throw err;
      }
    });
  }

  /**
   * Runs the workspace gormcsv's importcsv for one registered CSV, or all of them. importcsv
   * AutoMigrates each model's table (creating or altering it) and then batch-inserts the rows.
   * Queued with registrations, so an import never runs while the binary is being swapped.
   */
  populate({ file, batchSize, workers }: ImportRequest): Promise<ImportResult> {
    return this.exclusive(async () => {
      if (!(await stat(this.binPath).catch(() => null))) {
        throw new WorkspaceError('No models are built yet; register a CSV first', 'not-ready');
      }
      if (file !== undefined && !(await this.csvFiles()).includes(file)) {
        throw new WorkspaceError(`${file} is not a registered CSV`, 'not-found');
      }
      // The DSN goes in the environment: as an argument it would show in the process list.
      if (!(await this.binaryReadsDsnFromEnv())) {
        throw new WorkspaceError(
          'The workspace gormcsv cannot take the database from GORMCSV_DSN; register a model to ' +
            'rebuild it with a newer gormcsv',
          'not-ready',
        );
      }
      const files = file === undefined ? this.csvDir : join(this.csvDir, file);
      const args = [
        'importcsv',
        ['--files', files],
        ['--driver', this.database.driver],
        ['--batch-size', String(batchSize)],
        ['--workers', String(workers)],
        '--json',
      ].flat();
      // Workspace paths mean nothing to users, and a driver error could echo the DSN password.
      const clean = (text: string) => scrub(hideDir(text, this.csvDir), this.database);
      const { importTimeoutMs = 1_800_000 } = this.config;

      try {
        const { stdout } = await this.config.run(this.binPath, args, {
          timeoutMs: importTimeoutMs,
          env: { GORMCSV_DSN: this.database.dsn },
        });
        return this.importResult(true, stdout, clean);
      } catch (err: unknown) {
        if (err instanceof ReportError) {
          throw new WorkspaceError(`${err.message}; register a model to rebuild it`, 'failed');
        }
        if (err instanceof CommandError && !err.timedOut && err.exitCode !== null) {
          // importcsv prints its report before failing when it got as far as loading rows. If
          // stdout is not a report (it failed before that), its own error message is the answer.
          const result = this.partialResult(err.stdout, clean);
          if (result?.files.length) return result;
          throw new WorkspaceError(result?.errors[0] ?? clean(err.cliMessage), 'failed');
        }
        const message =
          err instanceof CommandError && err.timedOut ? 'importcsv timed out' : 'Import failed';
        throw new WorkspaceError(message, 'failed', clean(errorMessage(err)));
      }
    });
  }

  /**
   * Whether the built binary's importcsv reads GORMCSV_DSN. One that does not would ignore it and
   * write to gormcsv.db in the current directory, so check its help once per build.
   */
  private async binaryReadsDsnFromEnv(): Promise<boolean> {
    const builtAt = (await stat(this.binPath)).mtimeMs;
    if (this.envDsnCheck?.builtAt !== builtAt) {
      const help = await this.config
        .run(this.binPath, ['importcsv', '--help'])
        .then(({ stdout }) => stdout)
        .catch(() => '');
      this.envDsnCheck = { builtAt, supported: help.includes('GORMCSV_DSN') };
    }
    return this.envDsnCheck.supported;
  }

  private partialResult(stdout: string, clean: (text: string) => string): ImportResult | null {
    try {
      return stdout.trim() ? this.importResult(false, stdout, clean) : null;
    } catch (err: unknown) {
      if (err instanceof ReportError) return null;
      throw err;
    }
  }

  private importResult(
    complete: boolean,
    stdout: string,
    clean: (text: string) => string,
  ): ImportResult {
    const report = parseImportReport(stdout);
    return {
      complete,
      files: reportFiles(report),
      totals: {
        inserted: report.inserted,
        duplicates: report.duplicates,
        rejected: report.rejected,
      },
      errors: report.errors.map(clean),
      database: databaseInfo(this.database),
    };
  }

  private async readStatus(): Promise<WorkspaceStatus> {
    const problem = await this.problem();
    const files = await this.csvFiles();
    const binary = problem ? null : await this.binary();
    const built = binary ? await readFile(this.builtModels, 'utf8').catch(() => '[]') : '[]';
    const models = JSON.parse(built) as GoModel[];
    const duplicates = await this.readRules();
    const database = databaseInfo(this.database);
    return problem
      ? { ready: false, problem, files, models, binary, duplicates, database }
      : { ready: true, files, models, binary, duplicates, database };
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

  private async readRules(): Promise<Record<string, DuplicateRule>> {
    const text = await readFile(this.rulesPath, 'utf8').catch(() => '{}');
    return JSON.parse(text) as Record<string, DuplicateRule>;
  }

  private async writeRules(rules: Record<string, DuplicateRule>): Promise<void> {
    await writeFile(this.rulesPath, JSON.stringify(rules, null, 2));
  }

  private async generateModels(
    rules: Record<string, DuplicateRule>,
  ): Promise<{ warnings: string[]; models: GoModel[] }> {
    const { gormcsvBin = 'gormcsv', run } = this.config;
    const hidePaths = (text: string) => hideDir(text, this.csvDir);
    try {
      const { stdout } = await run(
        gormcsvBin,
        [
          'inspectcsv',
          ['--files', this.csvDir],
          ['--output', this.modelsGo],
          ...ruleFlags(rules),
          '--json',
        ].flat(),
        { timeoutMs: INSPECT_TIMEOUT_MS },
      );
      const report = parseInspectReport(stdout);
      return { warnings: reportWarnings(report, hidePaths), models: reportModels(report) };
    } catch (err: unknown) {
      if (err instanceof ReportError) {
        throw new WorkspaceError(err.message, 'build');
      }
      if (err instanceof CommandError && !err.timedOut && err.exitCode !== null) {
        throw new WorkspaceError(hidePaths(err.cliMessage), 'rejected');
      }
      throw new WorkspaceError('Generating models failed', 'build', errorMessage(err));
    }
  }

  private async build(models: GoModel[]): Promise<void> {
    const { srcDir, run, goBin = 'go', gitBin = 'git', buildTimeoutMs = 600_000 } = this.config;
    const version = await run(gitBin, ['describe', '--tags', '--always', '--dirty'], {
      cwd: srcDir,
    })
      .then(({ stdout }) => stdout.trim())
      .catch(() => 'devel');
    // Build beside the live binary; swapIn() moves it into place once everything is ready.
    await writeFile(`${this.builtModels}.next`, JSON.stringify(models, null, 2));
    try {
      await run(
        goBin,
        [
          'build',
          '-trimpath',
          '-ldflags',
          `-X ${VERSION_FLAG}=${version}`,
          '-o',
          `${this.binPath}.next`,
          '.',
        ],
        { cwd: srcDir, timeoutMs: buildTimeoutMs },
      );
    } catch (err: unknown) {
      const details =
        err instanceof CommandError && err.stderr
          ? err.stderr.trim().split('\n').slice(-DETAILS_LINES).join('\n')
          : errorMessage(err);
      const message =
        err instanceof CommandError && err.timedOut ? 'go build timed out' : 'go build failed';
      throw new WorkspaceError(message, 'build', details);
    }
  }

  /**
   * Moves the new binary and its models.json into place together, keeping the live ones as
   * .prev, so the binary and the models it reports always match. If a move fails, the ones
   * already made are undone. undo() also puts the previous pair back after a later failure;
   * discardPrevious() removes it once the new pair is confirmed.
   */
  private async swapIn(): Promise<Swap> {
    const moved: { path: string; hadLive: boolean }[] = [];
    const undo = async () => {
      for (const { path, hadLive } of [...moved].reverse()) {
        await rm(path, { force: true });
        if (hadLive) await rename(`${path}.prev`, path);
      }
    };
    try {
      for (const path of this.artifacts) {
        const hadLive = (await stat(path).catch(() => null)) !== null;
        if (hadLive) await rename(path, `${path}.prev`);
        moved.push({ path, hadLive });
        await rename(`${path}.next`, path);
      }
    } catch (err: unknown) {
      await undo();
      throw err;
    }
    const discardPrevious = async () => {
      await Promise.all(this.artifacts.map((path) => rm(`${path}.prev`, { force: true })));
    };
    return { undo, discardPrevious };
  }

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => undefined);
    return result;
  }
}

/** gormcsv keys a model by its lower-cased filename without .csv. */
export function modelKey(filename: string): string {
  return filename.replace(/\.csv$/i, '').toLowerCase();
}

/** gormcsv --key / --dedupe arguments for the rules, in a stable order. */
export function ruleFlags(rules: Record<string, DuplicateRule>): string[][] {
  return Object.keys(rules)
    .sort()
    .flatMap((key) => {
      const rule = rules[key];
      if (rule.mode === 'key') return [['--key', `${key}=${rule.columns.join('+')}`]];
      if (rule.mode === 'identical') return [['--dedupe', key]];
      return [];
    });
}
