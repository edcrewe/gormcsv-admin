/**
 * Reads the reports gormcsv prints with --json (inspectcsv, importcsv, tables and rows), and
 * converts them into the admin's API types.
 * gormcsv's text output was meant for people, so parsing it would break on any rewording; the
 * JSON report is a stable contract instead. Its shape is checked here at runtime, because it
 * crosses a process boundary: a different gormcsv build could print something else, and that
 * should fail with a clear message rather than as an undefined property deep in a route.
 * Warnings are formatted here too, so the wording users see is the admin's own.
 */

import type { GoModel, ImportFileResult, RowsPage, TableInfo } from '../shared/api-types';

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

// Shape checks for reports. Each takes an unknown value and says whether it fits, so a report is
// checked all the way down before it is trusted, and a mismatch anywhere is one ReportError.
type Check = (value: unknown) => boolean;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isString: Check = (value) => typeof value === 'string';
const isBoolean: Check = (value) => typeof value === 'boolean';
/** A row count, line number, limit or offset. */
const isCount: Check = (value) => Number.isSafeInteger(value) && (value as number) >= 0;
const optional =
  (check: Check): Check =>
  (value) =>
    value === undefined || check(value);
const listOf =
  (check: Check): Check =>
  (value) =>
    Array.isArray(value) && value.every(check);
/** An object of lists keyed by path; Go prints an empty map as null, so that counts too. */
const mapOf =
  (check: Check): Check =>
  (value) =>
    value === undefined || value === null || (isObject(value) && Object.values(value).every(check));
const shape =
  (fields: Record<string, Check>): Check =>
  (value) =>
    isObject(value) && Object.entries(fields).every(([name, check]) => check(value[name]));

const inspectReport = shape({
  output: optional(isString),
  models: listOf(
    shape({
      key: isString,
      name: isString,
      fields: listOf(
        shape({
          name: isString,
          type: isString,
          tag: optional(isString),
          column: optional(isString),
        }),
      ),
    }),
  ),
  skippedRows: mapOf(listOf(isCount)),
  warnings: mapOf(listOf(isString)),
});

const importReport = shape({
  files: listOf(
    shape({
      file: isString,
      model: isString,
      inserted: isCount,
      duplicates: isCount,
      rejected: isCount,
    }),
  ),
  inserted: isCount,
  duplicates: isCount,
  rejected: isCount,
  errors: listOf(isString),
});

const tablesReport = shape({
  tables: listOf(
    shape({
      name: isString,
      rows: isCount,
      columns: listOf(
        shape({ name: isString, type: isString, nullable: isBoolean, primaryKey: isBoolean }),
      ),
      indexes: listOf(shape({ name: isString, columns: listOf(isString), unique: isBoolean })),
    }),
  ),
});

/** A cell: gormcsv gives integers too large for a JavaScript number as strings of digits. */
const isCell: Check = (value) =>
  value === null || ['string', 'boolean'].includes(typeof value) || Number.isFinite(value);

const rowsPage: Check = (value) =>
  shape({
    table: isString,
    columns: listOf(isString),
    rows: listOf(listOf(isCell)),
    total: isCount,
    limit: isCount,
    offset: isCount,
    order: isString,
    desc: isBoolean,
  })(value) &&
  // Every row has a value for each column, in order.
  (value as RowsPage).rows.every((row) => row.length === (value as RowsPage).columns.length);

/** Parses a --json report and checks its shape, or throws a ReportError naming the command. */
function parseReport(stdout: string, command: string, check: Check): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new ReportError(`gormcsv ${command} did not print a JSON report; it may be too old`);
  }
  if (!check(value)) throw new ReportError(`gormcsv ${command} printed an unexpected report`);
  return value as Record<string, unknown>;
}

export function parseInspectReport(stdout: string): InspectReport {
  const report = parseReport(stdout, 'inspectcsv', inspectReport);
  return {
    output: (report['output'] as string | undefined) ?? '',
    models: report['models'] as InspectReport['models'],
    skippedRows: (report['skippedRows'] ?? {}) as InspectReport['skippedRows'],
    warnings: (report['warnings'] ?? {}) as InspectReport['warnings'],
  };
}

export function parseImportReport(stdout: string): ImportReport {
  return parseReport(stdout, 'importcsv', importReport) as unknown as ImportReport;
}

/** `gormcsv tables --json`: the tables, with their columns and indexes. */
export function parseTablesReport(stdout: string): TableInfo[] {
  return parseReport(stdout, 'tables', tablesReport)['tables'] as TableInfo[];
}

/** `gormcsv rows --json`: one page of a table. */
export function parseRowsReport(stdout: string): RowsPage {
  return parseReport(stdout, 'rows', rowsPage) as unknown as RowsPage;
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
