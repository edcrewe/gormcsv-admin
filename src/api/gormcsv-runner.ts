import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface RunResult {
  stdout: string;
  stderr: string;
}

/** Runs the gormcsv CLI with the given arguments. Injected so routes can be tested without the binary. */
export type GormcsvRunner = (args: string[]) => Promise<RunResult>;

/** A gormcsv run that did not succeed: non-zero exit, timeout, or the binary failed to start. */
export class GormcsvError extends Error {
  constructor(
    message: string,
    readonly stderr = '',
    readonly exitCode: number | null = null,
    readonly timedOut = false,
  ) {
    super(message);
    this.name = 'GormcsvError';
  }

  /** The CLI's own error message: first stderr line without cobra's "Error: " prefix. */
  get cliMessage(): string {
    const first = this.stderr.trim().split('\n')[0] ?? '';
    return first.replace(/^Error:\s*/, '') || this.message;
  }
}

export interface ExecRunnerOptions {
  binary?: string;
  timeoutMs?: number;
}

interface ExecFailure {
  message: string;
  stderr?: string;
  code?: number | string;
  killed?: boolean;
}

export function createExecRunner({
  binary = 'gormcsv',
  timeoutMs = 30_000,
}: ExecRunnerOptions = {}): GormcsvRunner {
  return async (args) => {
    try {
      const { stdout, stderr } = await execFileAsync(binary, args, { timeout: timeoutMs });
      return { stdout, stderr };
    } catch (err: unknown) {
      const failure = err as ExecFailure;
      const exitCode = typeof failure.code === 'number' ? failure.code : null;
      const timedOut = failure.killed === true;
      const message = timedOut ? `gormcsv timed out after ${timeoutMs}ms` : errorMessage(err);
      throw new GormcsvError(message, failure.stderr ?? '', exitCode, timedOut);
    }
  };
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
