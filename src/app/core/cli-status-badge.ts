/**
 * Toolbar badge showing the gormcsv version, or why the CLI is unusable. The template reads
 * CliStatusService's signals directly, so the badge re-renders whenever the status changes. The
 * health check starts in afterNextRender, which only runs in the browser after the first render.
 * During build-time prerendering there is no server to answer a relative /api URL. The badge is a
 * polite live region, so screen readers announce status changes without interrupting the user.
 */

import { Component, afterNextRender, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { CliStatusService } from './cli-status.service';

@Component({
  selector: 'app-cli-status-badge',
  imports: [MatIconModule],
  template: `
    <span role="status" aria-live="polite">
      @if (cli.status(); as status) {
        @if (status.ok) {
          <span class="badge ok">
            <mat-icon aria-hidden="true">check_circle</mat-icon>gormcsv {{ status.version }}
          </span>
        } @else {
          <span class="badge error" [title]="status.details ?? ''">
            <mat-icon aria-hidden="true">error</mat-icon>{{ status.error }}
          </span>
        }
      } @else {
        <span class="badge pending">Checking CLI…</span>
      }
    </span>
  `,
  styles: `
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 10px;
      border-radius: 12px;
      font: var(--mat-sys-label-large);
    }
    .ok {
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }
    .error {
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
    .pending {
      background: var(--mat-sys-surface-variant);
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class CliStatusBadge {
  protected cli = inject(CliStatusService);

  constructor() {
    // Routes are prerendered at build time, where a relative /api URL has no server; only check in the browser.
    afterNextRender(() => this.cli.check());
  }
}
