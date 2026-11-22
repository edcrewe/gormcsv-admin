/**
 * Paging state kept in the URL query (?page=2&size=50), shared by the Rows tab and History. Query
 * values arrive as strings, or are missing or junk when a URL is typed by hand, so these input()
 * transforms turn anything unusable into the default rather than an error, and keep a huge page
 * number within the offsets the API accepts. Pages are zero-based, as mat-paginator counts them.
 */

import { numberAttribute } from '@angular/core';
import { MAX_OFFSET } from '../../shared/paging';

export const PAGE_SIZES = [10, 25, 50, 100];
export const DEFAULT_PAGE_SIZE = 25;
/** The last page whose offset the API accepts at the largest page size. */
export const MAX_PAGE_INDEX = Math.floor(MAX_OFFSET / Math.max(...PAGE_SIZES));

export const pageIndex = (value: unknown) => {
  const page = Math.trunc(numberAttribute(value, 0));
  return Number.isFinite(page) ? Math.min(MAX_PAGE_INDEX, Math.max(0, page)) : 0;
};

export const pageSize = (value: unknown) => {
  const size = numberAttribute(value, DEFAULT_PAGE_SIZE);
  return PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE;
};

/** Query parameters for a paginator event; defaults become null, which removes them. */
export function pageParams(pageIndexValue: number, size: number) {
  return { page: pageIndexValue || null, size: size === DEFAULT_PAGE_SIZE ? null : size };
}
