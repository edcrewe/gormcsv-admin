import { readFileSync } from 'node:fs';
import {
  ReportError,
  parseImportReport,
  parseInspectReport,
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

  it('tolerates a report without skipped rows or warnings', () => {
    const minimal = parseInspectReport(JSON.stringify({ output: 'm.go', models: [] }));

    expect(reportWarnings(minimal, (p) => p)).toEqual([]);
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
