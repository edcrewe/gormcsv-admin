import { readFileSync } from 'node:fs';
import type { RowsPage, TableInfo } from '../shared/api-types';
import {
  ReportError,
  parseImportReport,
  parseInspectReport,
  parseRowsReport,
  parseTablesReport,
  reportFiles,
  reportModels,
  reportWarnings,
} from './gormcsv-json';

// Real gormcsv --json output for fixtures/Country.csv and TestTypes.csv in a csv/ dir.
const INSPECT = readFileSync('fixtures/inspect-report.json', 'utf8');
const IMPORT = readFileSync('fixtures/import-report.json', 'utf8');

describe('inspect reports', () => {
  const report = parseInspectReport(INSPECT);

  it('converts models, dropping tag backticks and keeping source columns', () => {
    const [country, testTypes] = reportModels(report);

    expect(country).toMatchObject({ name: 'Country', key: 'country' });
    expect(country.fields[0]).toEqual({ name: 'Name', type: 'string', column: 'name' });
    expect(country.fields.at(-1)).toEqual({ name: 'ModelField', type: 'string', column: 'model' });
    expect(testTypes.fields.map((f) => f.type)).toContain('time.Time');

    const tagged = reportModels({
      ...report,
      models: [
        {
          key: 'k',
          name: 'K',
          fields: [{ name: 'Code', type: 'string', tag: '`gorm:"uniqueIndex"`' }],
        },
      ],
    });
    expect(tagged[0].fields[0]).toEqual({
      name: 'Code',
      type: 'string',
      tag: 'gorm:"uniqueIndex"',
    });
  });

  it('formats skipped rows and warnings with the caller choosing how paths look', () => {
    expect(reportWarnings(report, (path) => path.replace('csv/', ''))).toEqual([
      'Country.csv: skipped 1 row with the wrong number of fields (line 148)',
      'Country.csv: column "model" generates field ModelField, because Model is reserved by gorm.Model',
    ]);
  });

  it('pluralises several skipped rows', () => {
    const several = { ...report, skippedRows: { 'a.csv': [3, 9] }, warnings: {} };

    expect(reportWarnings(several, (p) => p)).toEqual([
      'a.csv: skipped 2 rows with the wrong number of fields (lines 3, 9)',
    ]);
  });

  it('tolerates a report without skipped rows or warnings, or with them null', () => {
    const minimal = parseInspectReport(JSON.stringify({ output: 'm.go', models: [] }));
    const nulls = parseInspectReport(
      JSON.stringify({ output: 'm.go', models: [], skippedRows: null, warnings: null }),
    );

    expect(reportWarnings(minimal, (p) => p)).toEqual([]);
    expect(reportWarnings(nulls, (p) => p)).toEqual([]);
  });
});

describe('import reports', () => {
  it('reads per-file counts, totals and errors', () => {
    const report = parseImportReport(IMPORT);

    expect(reportFiles(report)).toEqual([
      { model: 'Country', inserted: 245, duplicates: 0, rejected: 1 },
      { model: 'TestTypes', inserted: 6, duplicates: 0, rejected: 0 },
    ]);
    expect([report.inserted, report.duplicates, report.rejected]).toEqual([251, 0, 1]);
    expect(report.errors).toEqual([
      'csv/Country.csv row 148: record on line 148: wrong number of fields',
    ]);
  });
});

describe('report validation', () => {
  it.each([
    ['text output from an older gormcsv', 'generated models.go\n', /did not print a JSON report/],
    ['a JSON array', '[]', /unexpected report/],
    ['models that are not a list', '{"models": {}}', /unexpected report/],
    ['a model without a name', '{"models": [{"key": "a", "fields": []}]}', /unexpected report/],
  ])('rejects %s from inspectcsv', (_label, stdout, message) => {
    expect(() => parseInspectReport(stdout)).toThrow(ReportError);
    expect(() => parseInspectReport(stdout)).toThrow(message);
  });

  it.each([
    [
      'text output from an older gormcsv',
      'TestTypes: inserted 6, skipped 0 duplicates, rejected 0\n',
    ],
    ['a report without files', '{"errors": []}'],
    ['a report without errors', '{"files": []}'],
  ])('rejects %s from importcsv', (_label, stdout) => {
    expect(() => parseImportReport(stdout)).toThrow(ReportError);
  });
});

const valid = (stdout: string) => JSON.parse(stdout) as Record<string, unknown>;
const inspect = valid(INSPECT);
const imported = valid(IMPORT);
const field = (inspect['models'] as { fields: unknown[] }[])[0].fields[0] as object;

describe('deep report validation', () => {
  it.each([
    [
      'a field without a type',
      { ...inspect, models: [{ key: 'a', name: 'A', fields: [{ name: 'X' }] }] },
    ],
    [
      'a field that is not an object',
      { ...inspect, models: [{ key: 'a', name: 'A', fields: ['X'] }] },
    ],
    [
      'a tag that is not text',
      { ...inspect, models: [{ key: 'a', name: 'A', fields: [{ ...field, tag: 1 }] }] },
    ],
    ['skipped rows that are not line numbers', { ...inspect, skippedRows: { 'a.csv': ['3'] } }],
    ['warnings that are not text', { ...inspect, warnings: { 'a.csv': [{}] } }],
  ])('rejects an inspect report with %s', (_label, report) => {
    expect(() => parseInspectReport(JSON.stringify(report))).toThrow(
      'gormcsv inspectcsv printed an unexpected report',
    );
  });

  const withoutTotal = { ...imported, inserted: undefined };
  const file = (imported['files'] as object[])[0];
  it.each([
    ['no inserted total', withoutTotal],
    ['a negative count', { ...imported, rejected: -1 }],
    ['a fractional count', { ...imported, duplicates: 0.5 }],
    ['a count as text', { ...imported, inserted: '251' }],
    ['a file without a model', { ...imported, files: [{ ...file, model: undefined }] }],
    ['a file count missing', { ...imported, files: [{ ...file, rejected: undefined }] }],
    ['an error that is not text', { ...imported, errors: [{ message: 'x' }] }],
  ])('rejects an import report with %s', (_label, report) => {
    expect(() => parseImportReport(JSON.stringify(report))).toThrow(
      'gormcsv importcsv printed an unexpected report',
    );
  });
});

const TABLE: TableInfo = {
  name: 'countries',
  rows: 245,
  columns: [{ name: 'id', type: 'bigint', nullable: false, primaryKey: true }],
  indexes: [{ name: 'idx_countries_code', columns: ['code'], unique: true }],
};

describe('tables reports', () => {
  it('accepts a report of tables', () => {
    expect(parseTablesReport(JSON.stringify({ tables: [TABLE] }))).toEqual([TABLE]);
    expect(parseTablesReport('{"tables": []}')).toEqual([]);
  });

  it('says an older gormcsv printed text', () => {
    expect(() => parseTablesReport('countries: 245 rows, 19 columns\n')).toThrow(
      'gormcsv tables did not print a JSON report; it may be too old',
    );
  });

  const column = TABLE.columns[0];
  const index = TABLE.indexes[0];
  it.each([
    ['no tables list', {}],
    ['a table without rows', { tables: [{ ...TABLE, rows: undefined }] }],
    ['a table without indexes', { tables: [{ ...TABLE, indexes: undefined }] }],
    ['a negative row count', { tables: [{ ...TABLE, rows: -1 }] }],
    [
      'a column without a type',
      { tables: [{ ...TABLE, columns: [{ ...column, type: undefined }] }] },
    ],
    [
      'a nullable flag as text',
      { tables: [{ ...TABLE, columns: [{ ...column, nullable: 'no' }] }] },
    ],
    [
      'index columns that are not a list',
      { tables: [{ ...TABLE, indexes: [{ ...index, columns: 'code' }] }] },
    ],
    [
      'index columns that are not text',
      { tables: [{ ...TABLE, indexes: [{ ...index, columns: [1] }] }] },
    ],
  ])('rejects %s', (_label, report) => {
    expect(() => parseTablesReport(JSON.stringify(report))).toThrow(ReportError);
    expect(() => parseTablesReport(JSON.stringify(report))).toThrow('printed an unexpected report');
  });
});

const PAGE: RowsPage = {
  table: 'countries',
  columns: ['id', 'name', 'big', 'flag'],
  rows: [
    [1, 'Afghanistan', '9007199254740993', true],
    [2, null, 3.5, false],
  ],
  total: 245,
  limit: 2,
  offset: 0,
  order: 'id',
  desc: false,
};

describe('rows reports', () => {
  it('accepts a page with nulls, booleans, fractions and large integers as text', () => {
    expect(parseRowsReport(JSON.stringify(PAGE))).toEqual(PAGE);
    expect(parseRowsReport(JSON.stringify({ ...PAGE, rows: [] }))).toEqual({ ...PAGE, rows: [] });
  });

  it.each([
    ['text', 'id name'],
    ['rows that are not lists', JSON.stringify({ ...PAGE, rows: [{ id: 1 }] })],
    ['no total', JSON.stringify({ ...PAGE, total: undefined })],
    ['no order', JSON.stringify({ ...PAGE, order: undefined })],
    ['a row shorter than the columns', JSON.stringify({ ...PAGE, rows: [[1, 'x', '1']] })],
    ['a row longer than the columns', JSON.stringify({ ...PAGE, rows: [[1, 'x', '1', true, 5]] })],
    ['an object in a cell', JSON.stringify({ ...PAGE, rows: [[1, 'x', { n: 1 }, true]] })],
    [
      'a column name that is not text',
      JSON.stringify({ ...PAGE, columns: ['id', 2, 'big', 'flag'] }),
    ],
    ['a negative offset', JSON.stringify({ ...PAGE, offset: -2 })],
  ])('rejects %s', (_label, stdout) => {
    expect(() => parseRowsReport(stdout)).toThrow(ReportError);
  });
});
