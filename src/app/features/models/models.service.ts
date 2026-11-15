/**
 * Workspace writes: registering a CSV (POST /api/models, which rebuilds gormcsv) and importing
 * registered CSVs into the database (POST /api/import). Like InspectService, each returns an
 * HttpClient Observable and maps failures with catchError. Here they become a ModelsApiError,
 * which also carries details, such as the tail of the go build output, so the UI can show why
 * something failed. Writes like this use HttpClient directly, because httpResource is meant for
 * reads that follow signals.
 */

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';
import {
  DuplicateRule,
  ImportRequest,
  ImportResult,
  RegisterResult,
  isApiError,
} from '../../../shared/api-types';

/** Raised when registering or importing fails; details carries tool output when there is any. */
export class ModelsApiError extends Error {
  constructor(
    message: string,
    readonly details?: string,
  ) {
    super(message);
    this.name = 'ModelsApiError';
  }
}

/** Registers CSVs as models and imports them, using the workspace gormcsv. */
@Service()
export class ModelsService {
  private http = inject(HttpClient);

  /** duplicates sets how the model treats rows already in its table; omit to keep its rule. */
  register(file: File, duplicates?: DuplicateRule): Observable<RegisterResult> {
    const body = new FormData();
    // Rule fields go before the file so the server has them when the upload finishes.
    if (duplicates) {
      body.append('duplicates', duplicates.mode);
      if (duplicates.mode === 'key') duplicates.columns.forEach((c) => body.append('keyColumn', c));
    }
    body.append('file', file, file.name);
    return this.http
      .post<RegisterResult>('/api/models', body)
      .pipe(catchError((err: HttpErrorResponse) => throwError(() => toModelsApiError(err))));
  }

  /** Migrates and populates tables from registered CSVs; resolves for partial imports too. */
  populate(request: ImportRequest): Observable<ImportResult> {
    return this.http
      .post<ImportResult>('/api/import', request)
      .pipe(catchError((err: HttpErrorResponse) => throwError(() => toModelsApiError(err))));
  }
}

export function toModelsApiError(err: HttpErrorResponse): ModelsApiError {
  if (isApiError(err.error)) {
    return new ModelsApiError(err.error.error, err.error.details);
  }
  return new ModelsApiError(
    err.status === 0 ? 'Server unreachable' : `Request failed (HTTP ${err.status})`,
  );
}
