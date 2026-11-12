import { RouterOutlet } from '@angular/router';
import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

interface HealthStatus {
  ok: boolean;
  version?: string;
  error?: string;
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  private http = inject(HttpClient);
  cliStatus = signal<HealthStatus | null>(null);

  ngOnInit() {
    this.http.get<HealthStatus>('/api/health').subscribe({
      next: (status) => this.cliStatus.set(status),
      error: (err) => this.cliStatus.set(err.error ?? { ok: false, error: 'Server unreachable' }),
    });
  }
}


