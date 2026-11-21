/**
 * Import history: every registration and import, newest first, read from GET /api/history. It
 * reuses the Rows tab's pattern. The page and size live in the URL query and arrive as signal
 * inputs through route input binding, the request URL is a computed() over them, and httpResource
 * refetches whenever it changes; the paginator only navigates. So the log can be bookmarked at a
 * page, and Back steps through pages. The route renders in the browser (app.routes.server.ts).
 */

import { Component, computed, inject, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import {
  HistoryEntry,
  HistoryPage as HistoryPageData,
  isApiError,
} from '../../../shared/api-types';
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  pageIndex,
  pageParams,
  pageSize,
} from '../../shared/paging';

const OUTCOME_ICONS: Record<HistoryEntry['outcome'], string> = {
  ok: 'check_circle',
  partial: 'warning',
  failed: 'error',
};

@Component({
  selector: 'app-history-page',
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatTableModule,
  ],
  templateUrl: './history-page.html',
  styleUrl: './history-page.scss',
})
export class HistoryPage {
  private router = inject(Router);

  readonly page = input(0, { transform: pageIndex });
  readonly size = input(DEFAULT_PAGE_SIZE, { transform: pageSize });

  protected readonly pageSizes = PAGE_SIZES;
  protected readonly columns = ['at', 'action', 'file', 'outcome', 'rows', 'details'];

  protected readonly history = httpResource<HistoryPageData>(
    () => `/api/history?limit=${this.size()}&offset=${this.page() * this.size()}`,
  );
  protected readonly data = computed(() => (this.history.hasValue() ? this.history.value() : null));
  protected readonly loadError = computed(() => {
    const err = this.history.error();
    if (!err) return null;
    if (err instanceof HttpErrorResponse && isApiError(err.error)) return err.error.error;
    return 'Could not load the history';
  });

  protected icon(entry: HistoryEntry): string {
    return OUTCOME_ICONS[entry.outcome] ?? 'help';
  }

  /** "245 inserted, 0 skipped, 1 rejected" for imports; blank otherwise. */
  protected rows(entry: HistoryEntry): string {
    const t = entry.totals;
    return t ? `${t.inserted} inserted, ${t.duplicates} skipped, ${t.rejected} rejected` : '';
  }

  protected onPage(event: PageEvent): void {
    void this.router.navigate([], {
      queryParams: pageParams(event.pageIndex, event.pageSize),
      queryParamsHandling: 'merge',
    });
  }

  protected reload(): void {
    this.history.reload();
  }
}
