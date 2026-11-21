import { readFileSync, readdirSync } from 'node:fs';
import { safeCsvName } from './upload';

// The CSVs in samples/ are for trying the admin out; each must be uploadable as it is.
describe('samples/', () => {
  const files = readdirSync('samples').filter((name) => name.endsWith('.csv'));

  it('has the documented samples', () => {
    expect(files.sort()).toEqual(['order-lines.csv', 'products.csv', 'readings.csv']);
  });

  it.each(files)('%s has an uploadable name and rows as wide as its header', (name) => {
    expect(safeCsvName(name)).toBe(name);
    const [header, ...rows] = readFileSync(`samples/${name}`, 'utf8').trim().split('\n');
    const width = header.split(',').length;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.split(',').length === width)).toBe(true);
  });
});
