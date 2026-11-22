/**
 * Reads ?limit and ?offset for the API's paged lists (a table's rows, the history). Both must be
 * plain whole numbers: no sign, decimal point or exponent, and one value each. The offset is
 * capped at MAX_OFFSET, so a number too big to be exact, or to pass to gormcsv, is a 400 rather
 * than a failed command.
 */

import { MAX_OFFSET } from '../shared/paging';

export interface Paging {
  limit: number;
  offset: number;
}

export interface PagingRules {
  defaultLimit: number;
  maxLimit: number;
}

/** The paging values, or a message saying what is wrong with them. */
export function parsePaging(
  query: Record<string, unknown>,
  { defaultLimit, maxLimit }: PagingRules,
): Paging | string {
  const limit = wholeNumber(query['limit'], defaultLimit);
  if (limit === null || limit < 1 || limit > maxLimit) {
    return `limit must be a whole number from 1 to ${maxLimit}`;
  }
  const offset = wholeNumber(query['offset'], 0);
  if (offset === null || offset > MAX_OFFSET) {
    return `offset must be a whole number from 0 to ${MAX_OFFSET}`;
  }
  return { limit, offset };
}

/** The value as a whole number, the fallback when it is absent, or null when it is not one. */
function wholeNumber(value: unknown, fallback: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d{1,16}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
