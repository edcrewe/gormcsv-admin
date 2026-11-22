/**
 * Paging limits shared by the API and the Angular app. MAX_OFFSET is the largest offset either
 * side uses: it fits the 32-bit int gormcsv's --offset is on any platform, and is far beyond any
 * table an admin pages through, so a hand-typed huge or infinite page number has a bound.
 */
export const MAX_OFFSET = 2_147_483_647;
