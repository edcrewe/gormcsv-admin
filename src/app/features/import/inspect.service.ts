import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';
import { InspectResult, isApiError } from '../../../shared/api-types';

/** Uploads a CSV to POST /api/inspect and returns the GORM model gormcsv generates for it. */
@Service()
export class InspectService {
  private http = inject(HttpClient);

  inspect(file: File): Observable<InspectResult> {
    const body = new FormData();
    body.append('file', file, file.name);
    return this.http
      .post<InspectResult>('/api/inspect', body)
      .pipe(
        catchError((err: HttpErrorResponse) =>
          throwError(() => new Error(inspectErrorMessage(err))),
        ),
      );
  }
}

export function inspectErrorMessage(err: HttpErrorResponse): string {
  if (isApiError(err.error)) {
    return err.error.error;
  }
  return err.status === 0 ? 'Server unreachable' : `Inspect failed (HTTP ${err.status})`;
}
