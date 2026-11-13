import { readFileSync } from 'node:fs';
import { parseGeneratedModels } from './go-model';

// Real `gormcsv inspectcsv` output for TestTypes.csv plus an order-item.csv with awkward headers.
const golden = readFileSync('fixtures/inspect-golden.models.go', 'utf8');

describe('parseGeneratedModels', () => {
  it('extracts every model with its factory key and fields, excluding gorm.Model', () => {
    expect(parseGeneratedModels(golden)).toEqual([
      {
        name: 'OrderItem',
        key: 'order-item',
        fields: [
          { name: 'Type', type: 'bool' },
          { name: 'Field1stCol', type: 'int8' },
          { name: 'UnitPrice', type: 'float64' },
        ],
      },
      {
        name: 'TestTypes',
        key: 'testtypes',
        fields: [
          { name: 'Wordcol', type: 'string' },
          { name: 'Codecol', type: 'string' },
          { name: 'Textcol', type: 'string' },
          { name: 'Bigtextcol', type: 'string' },
          { name: 'Numbercol', type: 'float64' },
          { name: 'Intcol', type: 'int16' },
          { name: 'Boolcol', type: 'bool' },
          { name: 'Datecol', type: 'time.Time' },
        ],
      },
    ]);
  });

  it('keeps struct tags and pointer types', () => {
    const source = [
      'type Thing struct {',
      '\tgorm.Model',
      '\tCode  string `gorm:"uniqueIndex"`',
      '\tPrice *float64',
      '}',
      '',
    ].join('\n');

    expect(parseGeneratedModels(source)).toEqual([
      {
        name: 'Thing',
        key: 'thing',
        fields: [
          { name: 'Code', type: 'string', tag: 'gorm:"uniqueIndex"' },
          { name: 'Price', type: '*float64' },
        ],
      },
    ]);
  });

  it('returns no models for source without structs', () => {
    expect(parseGeneratedModels('package importcsv\n')).toEqual([]);
  });
});
