/**
 * Turns `gormcsv importcsv` output into structured results. importcsv prints one summary line per
 * CSV on stdout ("Country: inserted 245, skipped 0 duplicates, rejected 1") and, when anything
 * failed, its joined errors on stderr: once after cobra's "Error: " prefix and once more from
 * main(). It is best effort, so valid rows are committed even when it exits 1; that is why the
 * summary lines are parsed from the failure as well as from a success. Errors are de-duplicated
 * in order, and the caller hides workspace paths before they reach the user.
 */

import type { ImportFileResult } from '../shared/api-types';

const SUMMARY_LINE = /^(.+): inserted (\d+), skipped (\d+) duplicates, rejected (\d+)$/;

export interface ParsedImport {
  files: ImportFileResult[];
  errors: string[];
}

export function parseImportOutput(stdout: string, stderr: string): ParsedImport {
  const files: ImportFileResult[] = [];
  for (const line of stdout.split('\n')) {
    const match = SUMMARY_LINE.exec(line.trim());
    if (match) {
      const [, model, inserted, duplicates, rejected] = match;
      files.push({ model, inserted: +inserted, duplicates: +duplicates, rejected: +rejected });
    }
  }
  const errors = [
    ...new Set(
      stderr
        .split('\n')
        .map((line) => line.replace(/^Error:\s*/, '').trim())
        .filter(Boolean),
    ),
  ];
  return { files, errors };
}

export function totals(files: ImportFileResult[]) {
  return files.reduce(
    (sum, f) => ({
      inserted: sum.inserted + f.inserted,
      duplicates: sum.duplicates + f.duplicates,
      rejected: sum.rejected + f.rejected,
    }),
    { inserted: 0, duplicates: 0, rejected: 0 },
  );
}
