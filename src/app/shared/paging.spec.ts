import { MAX_OFFSET } from '../../shared/paging';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_INDEX,
  PAGE_SIZES,
  pageIndex,
  pageParams,
  pageSize,
} from './paging';

describe('paging transforms', () => {
  it.each([
    [undefined, 0],
    ['3', 3],
    ['2.7', 2],
    ['-3', 0],
    ['abc', 0],
    ['1e400', 0],
    ['Infinity', 0],
    ['99999999999', MAX_PAGE_INDEX],
  ])('reads page %j as %i', (value, page) => {
    expect(pageIndex(value)).toBe(page);
  });

  it('keeps the last page within the offsets the API accepts at every page size', () => {
    for (const size of PAGE_SIZES) expect(MAX_PAGE_INDEX * size).toBeLessThanOrEqual(MAX_OFFSET);
  });

  it.each([
    [undefined, DEFAULT_PAGE_SIZE],
    ['50', 50],
    ['7', DEFAULT_PAGE_SIZE],
    ['1e400', DEFAULT_PAGE_SIZE],
  ])('reads size %j as %i', (value, size) => {
    expect(pageSize(value)).toBe(size);
  });

  it('drops default values from the URL', () => {
    expect(pageParams(0, DEFAULT_PAGE_SIZE)).toEqual({ page: null, size: null });
    expect(pageParams(2, 50)).toEqual({ page: 2, size: 50 });
  });
});
