import { parseImportOutput, totals } from './import-output';

// Real `gormcsv importcsv` output, with paths shortened.
const PARTIAL = {
  stdout:
    'Country: inserted 245, skipped 0 duplicates, rejected 1\n' +
    'TestTypes: inserted 6, skipped 0 duplicates, rejected 0\n',
  stderr:
    'Error: /ws/csv/Country.csv row 148: record on line 148: wrong number of fields\n' +
    '/ws/csv/Country.csv row 148: record on line 148: wrong number of fields\n',
};

const MANY_ERRORS = {
  stdout: 'TestTypes: inserted 1, skipped 0 duplicates, rejected 3\n',
  stderr: [
    'Error: /t/TestTypes.csv row 3: record on line 3: wrong number of fields',
    '/t/TestTypes.csv row 4: column "Numbercol": convert "notanumber" to float64: invalid syntax',
    '/t/TestTypes.csv row 5: column "Intcol": convert "99999999" to int16: value out of range',
    '/t/TestTypes.csv row 3: record on line 3: wrong number of fields',
    '/t/TestTypes.csv row 4: column "Numbercol": convert "notanumber" to float64: invalid syntax',
    '/t/TestTypes.csv row 5: column "Intcol": convert "99999999" to int16: value out of range',
    '',
  ].join('\n'),
};

describe('parseImportOutput', () => {
  it('parses one summary line per model from a clean import', () => {
    expect(
      parseImportOutput('TestTypes: inserted 6, skipped 0 duplicates, rejected 0\n', ''),
    ).toEqual({
      files: [{ model: 'TestTypes', inserted: 6, duplicates: 0, rejected: 0 }],
      errors: [],
    });
  });

  it('keeps counts and the row error from a partial import, printed once', () => {
    expect(parseImportOutput(PARTIAL.stdout, PARTIAL.stderr)).toEqual({
      files: [
        { model: 'Country', inserted: 245, duplicates: 0, rejected: 1 },
        { model: 'TestTypes', inserted: 6, duplicates: 0, rejected: 0 },
      ],
      errors: ['/ws/csv/Country.csv row 148: record on line 148: wrong number of fields'],
    });
  });

  it('lists several row errors in order without the repeated copy', () => {
    const { errors } = parseImportOutput(MANY_ERRORS.stdout, MANY_ERRORS.stderr);

    expect(errors).toHaveLength(3);
    expect(errors.map((e) => e.split(':')[0])).toEqual([
      '/t/TestTypes.csv row 3',
      '/t/TestTypes.csv row 4',
      '/t/TestTypes.csv row 5',
    ]);
  });

  it('returns no files when importcsv failed before loading any rows', () => {
    const stderr =
      'Error: open sqlite database: unable to open database file\n' +
      'open sqlite database: unable to open database file\n';

    expect(parseImportOutput('', stderr)).toEqual({
      files: [],
      errors: ['open sqlite database: unable to open database file'],
    });
  });

  it('ignores lines that are not summaries', () => {
    expect(parseImportOutput('something else\nX: inserted many\n', '').files).toEqual([]);
  });
});

describe('totals', () => {
  it('sums the counts across files', () => {
    const { files } = parseImportOutput(PARTIAL.stdout, '');

    expect(totals(files)).toEqual({ inserted: 251, duplicates: 0, rejected: 1 });
  });

  it('is all zero for no files', () => {
    expect(totals([])).toEqual({ inserted: 0, duplicates: 0, rejected: 0 });
  });
});
