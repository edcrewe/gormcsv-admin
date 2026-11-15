/**
 * Runs external programs (gormcsv, git and go) for the API. It uses execFile rather than exec, so
 * arguments go straight to the program with no shell and an uploaded filename cannot inject shell
 * syntax. Node's callback-style execFile is wrapped with util.promisify so callers can `await` it.
 * A non-zero exit, a timeout or a missing binary rejects the promise, and that is converted into a
 * CommandError carrying stderr, the exit code and whether it timed out. That lets routes tell "the
 * CLI rejected this CSV" apart from "the CLI is broken". The CommandRunner and GormcsvRunner
 * function types are the seam that tests replace with fakes.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface RunResult {
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  timeoutMs?: number;
}

/** Runs any command without a shell. Injected so callers can be tested without real binaries. */
export type CommandRunner = (
  command: string,
  args: string[],
  options?: RunOptions,
) => Promise<RunResult>;

/** Runs the gormcsv CLI with the given arguments. */
export type GormcsvRunner = (args: string[]) => Promise<RunResult>;

/** A command that did not succeed: non-zero exit, timeout, or the binary failed to start. */
export class CommandError extends Error {
  constructor(
    message: string,
    readonly stderr = '',
    readonly exitCode: number | null = null,
    readonly timedOut = false,
    /** Some commands, such as importcsv, report partial results on stdout before failing. */
    readonly stdout = '',
  ) {
    super(message);
    this.name = 'CommandError';
  }

  /** The CLI's own error message: first stderr line without cobra's "Error: " prefix. */
  get cliMessage(): string {
    const first = this.stderr.trim().split('\n')[0] ?? '';
    return first.replace(/^Error:\s*/, '') || this.message;
  }
}

interface ExecFailure {
  message: string;
  stdout?: string;
  stderr?: string;
  code?: number | string;
  killed?: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;
// go build output for a big module can exceed execFile's 1 MiB default.
const MAX_BUFFER = 16 * 1024 * 1024;

export function createCommandRunner(): CommandRunner {
  return async (command, args, { cwd, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        cwd,
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER,
      });
      return { stdout, stderr };
    } catch (err: unknown) {
      const failure = err as ExecFailure;
      const exitCode = typeof failure.code === 'number' ? failure.code : null;
      const timedOut = failure.killed === true;
      const message = timedOut ? `${command} timed out after ${timeoutMs}ms` : errorMessage(err);
      throw new CommandError(
        message,
        failure.stderr ?? '',
        exitCode,
        timedOut,
        failure.stdout ?? '',
      );
    }
  };
}

export interface ExecRunnerOptions {
  binary?: string;
  timeoutMs?: number;
  run?: CommandRunner;
}

export function createExecRunner({
  binary = 'gormcsv',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  run = createCommandRunner(),
}: ExecRunnerOptions = {}): GormcsvRunner {
  return (args) => run(binary, args, { timeoutMs });
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
