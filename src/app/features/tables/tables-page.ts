/**
 * Tables page: the import database's tables, and one table's schema. Two Angular features carry
 * it. httpResource loads GET /api/tables once and exposes its value, loading and error states as
 * signals. withComponentInputBinding (app.config.ts) turns the :name route parameter into the
 * name signal input, so /tables/countries selects a table by URL, and the browser's back button
 * and bookmarks work with no extra code. computed() then finds the selected table in the loaded
 * list, and the template just reads it. The route renders in the browser only, since the data is
 * live (app.routes.server.ts). Query parameters bind the same way: ?view=rows picks the Rows
 * tab, and its page and sort parameters pass straight through to TableRows.
 */

import { Component, computed, input } from '@angular/core';
import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { TableRows } from './table-rows';
import { TablesResponse, isApiError } from '../../../shared/api-types';

@Component({
  selector: 'app-tables-page',
  imports: [
    RouterLink,
    RouterLinkActive,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatProgressBarModule,
    MatTableModule,
    MatTabsModule,
    TableRows,
  ],
  templateUrl: './tables-page.html',
  styleUrl: './tables-page.scss',
})
export class TablesPage {
  /** From the :name route parameter; undefined on /tables. */
  readonly name = input<string>();
  /** Query parameters, also bound by the router: which tab, and the rows view's page and sort. */
  readonly view = input<string>();
  readonly page = input<string>();
  readonly size = input<string>();
  readonly sort = input<string>();
  readonly dir = input<string>();
  protected readonly showRows = computed(() => this.view() === 'rows');

  protected readonly data = httpResource<TablesResponse>(() => '/api/tables');
  protected readonly columns = ['name', 'type', 'nullable', 'primaryKey'];

  protected readonly response = computed(() => (this.data.hasValue() ? this.data.value() : null));
  protected readonly tables = computed(() => this.response()?.tables ?? []);
  protected readonly selected = computed(() => {
    const name = this.name();
    return name ? (this.tables().find((t) => t.name === name) ?? null) : null;
  });
  protected readonly loadError = computed(() => {
    const err = this.data.error();
    if (!err) return null;
    if (err instanceof HttpErrorResponse && isApiError(err.error)) return err.error.error;
    return 'Could not load the tables';
  });

  protected reload(): void {
    this.data.reload();
  }
}
