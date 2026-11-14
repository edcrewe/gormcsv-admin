/**
 * Registers a CSV with POST /api/models. Like InspectService, it returns an HttpClient Observable
 * and maps failures with catchError. Here they become a RegisterError, which also carries details
 * (the tail of the go build output), so the UI can show why a build failed. Writes like this use
 * HttpClient directly, because httpResource is meant for reads that follow signals.
 */

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Service, inject } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';
import { RegisterResult, isApiError } from '../../../shared/api-types';

/** Raised when registering fails; details carries go build output when there is any. */
export class RegisterError extends Error {
  constructor(
    message: string,
    readonly details?: string,
  ) {
    super(message);
    this.name = 'RegisterError';
  }
}

/** Registers CSVs as models in the workspace, which rebuilds the workspace gormcsv. */
@Service()
export class ModelsService {
  private http = inject(HttpClient);

  register(file: File): Observable<RegisterResult> {
    const body = new FormData();
    body.append('file', file, file.name);
    return this.http
      .post<RegisterResult>('/api/models', body)
      .pipe(catchError((err: HttpErrorResponse) => throwError(() => toRegisterError(err))));
  }
}

export function toRegisterError(err: HttpErrorResponse): RegisterError {
  if (isApiError(err.error)) {
    return new RegisterError(err.error.error, err.error.details);
  }
  return new RegisterError(
    err.status === 0 ? 'Server unreachable' : `Registering failed (HTTP ${err.status})`,
  );
}
