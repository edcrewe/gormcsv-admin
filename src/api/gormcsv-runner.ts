import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface RunResult {
  stdout: string;
  stderr: string;
}

/** Runs the gormcsv CLI with the given arguments. Injected so routes can be tested without the binary. */
export type GormcsvRunner = (args: string[]) => Promise<RunResult>;

export interface ExecRunnerOptions {
  binary?: string;
  timeoutMs?: number;
}

export function createExecRunner({
  binary = 'gormcsv',
  timeoutMs = 30_000,
}: ExecRunnerOptions = {}): GormcsvRunner {
  return async (args) => {
    const { stdout, stderr } = await execFileAsync(binary, args, { timeout: timeoutMs });
    return { stdout, stderr };
  };
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
