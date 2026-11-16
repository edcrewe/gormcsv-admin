/**
 * One page of a table's rows, with paging and sorting. Its state lives in the URL query (page,
 * size, sort, dir): the Tables page receives those through route input binding and passes them
 * in as signal inputs. The request URL is a computed() over the inputs, and httpResource refetches
 * whenever it changes, so there is no subscribe, no manual refresh, and back and forward replay
 * pages. Clicking a sort header or the paginator only navigates; the URL change drives the fetch.
 * The table's columns come from the response, so one component shows any table.
 */

import { Component, computed, inject, input, numberAttribute } from '@angular/core';
import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { Router } from '@angular/router';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { RowsPage, isApiError } from '../../../shared/api-types';

export const PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_SIZE = 25;

/** Query values arrive as strings; anything unusable falls back to the default. */
const pageIndex = (value: unknown) => Math.max(0, Math.trunc(numberAttribute(value, 0)));
const pageSize = (value: unknown) => {
  const size = numberAttribute(value, DEFAULT_SIZE);
  return PAGE_SIZES.includes(size) ? size : DEFAULT_SIZE;
};

@Component({
  selector: 'app-table-rows',
  imports: [MatPaginatorModule, MatProgressBarModule, MatSortModule, MatTableModule],
  templateUrl: './table-rows.html',
  styleUrl: './table-rows.scss',
})
export class TableRows {
  private router = inject(Router);

  readonly table = input.required<string>();
  /** Zero-based, as mat-paginator counts. */
  readonly page = input(0, { transform: pageIndex });
  readonly size = input(DEFAULT_SIZE, { transform: pageSize });
  readonly sort = input<string>();
  /** asc or desc; named so it does not clash with the CDK's [dir] directive. */
  readonly direction = input<string>();

  protected readonly pageSizes = PAGE_SIZES;
  protected readonly descending = computed(() => this.direction() === 'desc');

  protected readonly url = computed(() => {
    const params = new URLSearchParams({
      limit: String(this.size()),
      offset: String(this.page() * this.size()),
    });
    const sort = this.sort();
    if (sort) params.set('sort', sort);
    if (this.descending()) params.set('dir', 'desc');
    return `/api/tables/${encodeURIComponent(this.table())}/rows?${params}`;
  });
  protected readonly rows = httpResource<RowsPage>(() => this.url());

  protected readonly data = computed(() => (this.rows.hasValue() ? this.rows.value() : null));
  protected readonly loadError = computed(() => {
    const err = this.rows.error();
    if (!err) return null;
    if (err instanceof HttpErrorResponse && isApiError(err.error)) return err.error.error;
    return 'Could not load the rows';
  });
  /** Which rows are on screen, e.g. "26–50 of 245". */
  protected readonly range = computed(() => {
    const data = this.data();
    if (!data || data.total === 0) return 'No rows';
    const first = data.offset + 1;
    return `Rows ${first}–${data.offset + data.rows.length} of ${data.total}`;
  });

  protected onSort(sort: Sort): void {
    this.navigate({
      sort: sort.direction ? sort.active : null,
      dir: sort.direction === 'desc' ? 'desc' : null,
      page: null,
    });
  }

  protected onPage(event: PageEvent): void {
    this.navigate({
      page: event.pageIndex || null,
      size: event.pageSize === DEFAULT_SIZE ? null : event.pageSize,
    });
  }

  /** Changes the query; null removes a parameter, keeping URLs short for the defaults. */
  private navigate(queryParams: Record<string, string | number | null>): void {
    void this.router.navigate([], { queryParams, queryParamsHandling: 'merge' });
  }

  protected display(value: unknown): string {
    if (value === null || value === undefined) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
}
