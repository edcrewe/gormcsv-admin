/**
 * Models page: what the workspace gormcsv can import. The data comes from httpResource, Angular's
 * signal-based way to fetch data. It sends the GET when the component is created and exposes
 * value(), isLoading(), error() and hasValue() as signals. The template just reads those signals,
 * so there is no subscribe or unsubscribe to manage, and reload() fetches again. This route renders
 * in the browser only (see app.routes.server.ts), because the data cannot be fetched at build time.
 */

import { Component, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse, httpResource } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { WorkspaceStatus, isApiError } from '../../../shared/api-types';
import { ModelFieldsTable } from '../../shared/model-fields-table';

@Component({
  selector: 'app-models-page',
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    ModelFieldsTable,
  ],
  templateUrl: './models-page.html',
  styleUrl: './models-page.scss',
})
export class ModelsPage {
  // httpResource fetches on creation and exposes value, error and loading state as signals.
  protected readonly workspace = httpResource<WorkspaceStatus>(() => '/api/models');

  protected readonly status = computed(() =>
    this.workspace.hasValue() ? this.workspace.value() : null,
  );
  protected readonly loadError = computed(() => {
    const err = this.workspace.error();
    if (!err) return null;
    if (err instanceof HttpErrorResponse && isApiError(err.error)) return err.error.error;
    return 'Could not load the workspace';
  });

  protected reload(): void {
    this.workspace.reload();
  }
}
