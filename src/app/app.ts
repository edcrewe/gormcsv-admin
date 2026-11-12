import { RouterOutlet } from '@angular/router';
import { Component, afterNextRender, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';

export interface HealthStatus {
  ok: boolean;
  summary?: string;
  error?: string;
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  private http = inject(HttpClient);
  cliStatus = signal<HealthStatus | null>(null);

  constructor() {
    // Routes are prerendered at build time, where a relative /api URL has no server; only check in the browser.
    afterNextRender(() => this.checkHealth());
  }

  private checkHealth() {
    this.http.get<HealthStatus>('/api/health').subscribe({
      next: (status) => this.cliStatus.set(status),
      error: (err: HttpErrorResponse) => this.cliStatus.set(toHealthStatus(err)),
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
