import { DuplicateRule } from '../../shared/api-types';
import { describeDuplicateRule } from './duplicate-rule';

describe('describeDuplicateRule', () => {
  const cases: [DuplicateRule | undefined, string][] = [
    [undefined, 'imported again'],
    [{ mode: 'allow' }, 'imported again'],
    [{ mode: 'identical' }, 'skipped when the whole row matches'],
    [{ mode: 'key', columns: ['code'] }, 'skipped when code matches'],
    [{ mode: 'key', columns: ['order_id', 'line'] }, 'skipped when order_id + line match'],
  ];

  it.each(cases)('describes %j as %j', (rule, text) => {
    expect(describeDuplicateRule(rule)).toBe(text);
  });
});
