/**
 * Reads the reports gormcsv prints with --json, and converts them into the admin's API types.
 * gormcsv's text output was meant for people, so parsing it would break on any rewording; the
 * JSON report is a stable contract instead. Its shape is checked here at runtime, because it
 * crosses a process boundary: a different gormcsv build could print something else, and that
 * should fail with a clear message rather than as an undefined property deep in a route.
 * Warnings are formatted here too, so the wording users see is the admin's own.
 */

import type { GoModel, ImportFileResult } from '../shared/api-types';

interface ReportField {
  name: string;
  type: string;
  tag?: string;
  column?: string;
}

/** `gormcsv inspectcsv --json` */
export interface InspectReport {
  output: string;
  models: { key: string; name: string; fields: ReportField[] }[];
  skippedRows: Record<string, number[]>;
  warnings: Record<string, string[]>;
}

/** `gormcsv importcsv --json` */
export interface ImportReport {
  files: {
    file: string;
    model: string;
    inserted: number;
    duplicates: number;
    rejected: number;
  }[];
  inserted: number;
  duplicates: number;
  rejected: number;
  errors: string[];
}

export class ReportError extends Error {
  override name = 'ReportError';
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseJson(stdout: string, command: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new ReportError(`gormcsv ${command} did not print a JSON report; it may be too old`);
  }
  if (!isObject(value)) throw new ReportError(`gormcsv ${command} printed an unexpected report`);
  return value;
}

export function parseInspectReport(stdout: string): InspectReport {
  const report = parseJson(stdout, 'inspectcsv');
  const models = report['models'];
  if (
    !Array.isArray(models) ||
    !models.every(
      (m) =>
        isObject(m) &&
        typeof m['key'] === 'string' &&
        typeof m['name'] === 'string' &&
        Array.isArray(m['fields']),
    )
  ) {
    throw new ReportError('gormcsv inspectcsv printed an unexpected report');
  }
  return {
    output: String(report['output'] ?? ''),
    models: models as InspectReport['models'],
    skippedRows: (isObject(report['skippedRows']) ? report['skippedRows'] : {}) as Record<
      string,
      number[]
    >,
    warnings: (isObject(report['warnings']) ? report['warnings'] : {}) as Record<string, string[]>,
  };
}

export function parseImportReport(stdout: string): ImportReport {
  const report = parseJson(stdout, 'importcsv');
  if (!Array.isArray(report['files']) || !Array.isArray(report['errors'])) {
    throw new ReportError('gormcsv importcsv printed an unexpected report');
  }
  return report as unknown as ImportReport;
}

/** The generated models in the admin's shape; struct tags lose their backticks. */
export function reportModels(report: InspectReport): GoModel[] {
  return report.models.map((model) => ({
    name: model.name,
    key: model.key,
    fields: model.fields.map((f) => ({
      name: f.name,
      type: f.type,
      ...(f.tag && { tag: f.tag.replace(/^`|`$/g, '') }),
      ...(f.column && { column: f.column }),
    })),
  }));
}

/** Skipped rows and other warnings, one line each, with paths shown however the caller likes. */
export function reportWarnings(
  report: InspectReport,
  showPath: (path: string) => string,
): string[] {
  const skipped = Object.entries(report.skippedRows).map(([path, lines]) => {
    const rows = lines.length === 1 ? 'row' : 'rows';
    const lineWord = lines.length === 1 ? 'line' : 'lines';
    const where = `${lineWord} ${lines.join(', ')}`;
    const skipped = `skipped ${lines.length} ${rows} with the wrong number of fields`;
    return `${showPath(path)}: ${skipped} (${where})`;
  });
  const other = Object.entries(report.warnings).flatMap(([path, warnings]) =>
    warnings.map((warning) => `${showPath(path)}: ${warning}`),
  );
  return [...skipped, ...other];
}

export function reportFiles(report: ImportReport): ImportFileResult[] {
  return report.files.map(({ model, inserted, duplicates, rejected }) => ({
    model,
    inserted,
    duplicates,
    rejected,
  }));
}
