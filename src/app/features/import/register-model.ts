/**
 * Step 2 of the import flow: registers the inspected CSV as a model, which rebuilds the workspace
 * gormcsv on the server (src/api/workspace.ts explains why). It also sets how the model treats
 * rows already in its table: import them again, skip rows whose key columns match, or skip rows
 * that match exactly. The choice is held in plain signals (mode and the chosen key columns), and
 * computed() derives the rule to send and whether it is complete. On a cold build the request can
 * take minutes, so a state signal (idle, registering, done or error) drives a progress bar and
 * disables the button. file, modelName and columns are signal inputs set by the import page,
 * which re-creates this component for each new file, resetting all of it.
 */

import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatRadioModule } from '@angular/material/radio';
import { DuplicateRule, RegisterResult } from '../../../shared/api-types';
import { ModelsService, ModelsApiError } from '../models/models.service';

type RegisterState =
  | { kind: 'idle' }
  | { kind: 'registering' }
  | { kind: 'done'; result: RegisterResult }
  | { kind: 'error'; message: string; details?: string };

/** Step 2 of an import: adds the inspected CSV to the workspace and rebuilds gormcsv. */
@Component({
  selector: 'app-register-model',
  imports: [
    RouterLink,
    MatButtonModule,
    MatCheckboxModule,
    MatIconModule,
    MatProgressBarModule,
    MatRadioModule,
  ],
  templateUrl: './register-model.html',
  styleUrl: './register-model.scss',
})
export class RegisterModel {
  private models = inject(ModelsService);

  readonly file = input.required<File>();
  readonly modelName = input.required<string>();
  /** CSV headings that can form a key. */
  readonly columns = input.required<string[]>();

  protected readonly mode = signal<DuplicateRule['mode']>('allow');
  protected readonly keyColumns = signal<readonly string[]>([]);
  protected readonly rule = computed<DuplicateRule>(() => {
    const mode = this.mode();
    return mode === 'key' ? { mode, columns: [...this.keyColumns()] } : { mode };
  });
  protected readonly ruleComplete = computed(
    () => this.mode() !== 'key' || this.keyColumns().length > 0,
  );

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

  protected setKeyColumn(column: string, checked: boolean): void {
    // Keep the CSV's column order, so a composite key reads the same way as the file.
    const chosen = new Set(this.keyColumns());
    if (checked) chosen.add(column);
    else chosen.delete(column);
    this.keyColumns.set(this.columns().filter((c) => chosen.has(c)));
  }

  protected register(): void {
    if (this.state().kind === 'registering' || !this.ruleComplete()) return;
    this.state.set({ kind: 'registering' });
    this.models.register(this.file(), this.rule()).subscribe({
      next: (result) => this.state.set({ kind: 'done', result }),
      error: (err: ModelsApiError) =>
        this.state.set({ kind: 'error', message: err.message, details: err.details }),
    });
  }
}
