import { MAX_OFFSET } from '../shared/paging';
import { parsePaging } from './paging';

const RULES = { defaultLimit: 25, maxLimit: 200 };

describe('parsePaging', () => {
  it.each([
    [{}, { limit: 25, offset: 0 }],
    [
      { limit: '200', offset: '40' },
      { limit: 200, offset: 40 },
    ],
    [{ offset: String(MAX_OFFSET) }, { limit: 25, offset: MAX_OFFSET }],
    [{ offset: '007' }, { limit: 25, offset: 7 }],
  ])('reads %j', (query, paging) => {
    expect(parsePaging(query, RULES)).toEqual(paging);
  });

  const LIMIT = 'limit must be a whole number from 1 to 200';
  const OFFSET = `offset must be a whole number from 0 to ${MAX_OFFSET}`;

  it.each([
    [{ limit: '0' }, LIMIT],
    [{ limit: '201' }, LIMIT],
    [{ limit: 'x' }, LIMIT],
    [{ limit: '2.5' }, LIMIT],
    [{ limit: ['1', '2'] }, LIMIT],
    [{ offset: '-1' }, OFFSET],
    [{ offset: '+1' }, OFFSET],
    [{ offset: '1e3' }, OFFSET],
    [{ offset: 'Infinity' }, OFFSET],
    [{ offset: '' }, OFFSET],
    [{ offset: String(MAX_OFFSET + 1) }, OFFSET],
    // Too many digits to be exact as a number; once rounded it would page somewhere else.
    [{ offset: '9007199254740993' }, OFFSET],
    [{ offset: '1'.repeat(400) }, OFFSET],
  ])('rejects %j', (query, message) => {
    expect(parsePaging(query, RULES)).toBe(message);
  });
});
