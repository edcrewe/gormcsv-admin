import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RegisterResult } from '../../../shared/api-types';
import { ModelsService, RegisterError } from '../models/models.service';

type RegisterState =
  | { kind: 'idle' }
  | { kind: 'registering' }
  | { kind: 'done'; result: RegisterResult }
  | { kind: 'error'; message: string; details?: string };

/** Step 2 of an import: adds the inspected CSV to the workspace and rebuilds gormcsv. */
@Component({
  selector: 'app-register-model',
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule],
  template: `
    <section aria-labelledby="register-heading">
      <h3 id="register-heading">2. Register the model</h3>
      <p>
        Registering adds {{ file().name }} to the workspace and rebuilds gormcsv with every
        registered model, so it can import them. The first build can take a few minutes.
      </p>
      <button
        matButton="filled"
        type="button"
        [disabled]="state().kind === 'registering'"
        (click)="register()"
      >
        Register {{ modelName() }}
      </button>
      @if (state().kind === 'registering') {
        <mat-progress-bar mode="indeterminate" aria-label="Building gormcsv" />
      }

      <div role="status" aria-live="polite">
        @if (result(); as result) {
          <div class="success">
            <mat-icon aria-hidden="true">check_circle</mat-icon>
            <span>
              Registered {{ result.file }}. gormcsv {{ result.status.binary?.version }} can now
              import {{ modelNames() }}.
              <a routerLink="/models">View models</a>
            </span>
          </div>
          @if (result.warnings.length) {
            <ul class="warnings">
              @for (warning of result.warnings; track $index) {
                <li>{{ warning }}</li>
              }
            </ul>
          }
        }
      </div>

      @if (failure(); as failure) {
        <div class="error" role="alert">
          <mat-icon aria-hidden="true">error</mat-icon>
          <span>{{ failure.message }}. The workspace was left unchanged.</span>
        </div>
        @if (failure.details) {
          <details>
            <summary>Build output</summary>
            <pre tabindex="0">{{ failure.details }}</pre>
          </details>
        }
      }
    </section>
  `,
  styles: `
    section {
      margin-top: 24px;
    }
    mat-progress-bar {
      margin-top: 12px;
    }
    .success,
    .error {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 16px;
      padding: 12px 16px;
      border-radius: 8px;
    }
    .success {
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }
    .success a {
      color: inherit;
    }
    .error {
      background: var(--mat-sys-error-container);
      color: var(--mat-sys-on-error-container);
    }
    pre {
      overflow: auto;
      max-height: 320px;
      padding: 12px;
      background: var(--mat-sys-surface-container);
    }
  `,
})
export class RegisterModel {
  private models = inject(ModelsService);

  readonly file = input.required<File>();
  readonly modelName = input.required<string>();

  protected readonly state = signal<RegisterState>({ kind: 'idle' });
  protected readonly result = computed(() => {
    const s = this.state();
    return s.kind === 'done' ? s.result : null;
  });
  protected readonly failure = computed(() => {
    const s = this.state();
    return s.kind === 'error' ? s : null;
  });
  protected readonly modelNames = computed(
    () =>
      this.result()
        ?.status.models.map((m) => m.name)
        .join(', ') ?? '',
  );

  protected register(): void {
    if (this.state().kind === 'registering') return;
    this.state.set({ kind: 'registering' });
    this.models.register(this.file()).subscribe({
      next: (result) => this.state.set({ kind: 'done', result }),
      error: (err: RegisterError) =>
        this.state.set({ kind: 'error', message: err.message, details: err.details }),
    });
  }
}
