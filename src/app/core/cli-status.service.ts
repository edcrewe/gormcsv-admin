import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Service, computed, inject, signal } from '@angular/core';

export interface HealthStatus {
  ok: boolean;
  summary?: string;
  error?: string;
}

/** Holds the result of GET /api/health so any component can show whether the gormcsv CLI is usable. */
@Service()
export class CliStatusService {
  private http = inject(HttpClient);
  private readonly _status = signal<HealthStatus | null>(null);

  /** null until the first check completes. */
  readonly status = this._status.asReadonly();
  readonly ready = computed(() => this._status()?.ok === true);

  check(): void {
    this.http.get<HealthStatus>('/api/health').subscribe({
      next: (status) => this._status.set(status),
      error: (err: HttpErrorResponse) => this._status.set(toHealthStatus(err)),
    });
  }
}

function toHealthStatus(err: HttpErrorResponse): HealthStatus {
  const body: unknown = err.error;
  if (typeof body === 'object' && body !== null && 'ok' in body) {
    return body as HealthStatus;
  }
  return { ok: false, error: 'Server unreachable' };
}
