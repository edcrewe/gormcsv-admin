/**
 * "Populate tables" panel on the Models page: runs importcsv for one registered CSV or all of them,
 * then shows rows inserted, duplicates skipped and rows rejected, with any row errors. The options
 * form uses Signal Forms. form() wraps a writable signal of the model, the schema function adds
 * required/min/max validation, and [formField] binds each input both ways. Each field is a signal
 * you call, e.g. options.batchSize().errors(), so the template re-renders as values change.
 * submit() marks every field touched, runs the action only when the form is valid, and sets
 * submitting() while the action's promise is pending. That is why the action converts the
 * HttpClient Observable to a promise with firstValueFrom.
 */

import { Component, computed, inject, input, signal } from '@angular/core';
import { form, FormField, max, min, required, submit } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { ImportResult } from '../../../shared/api-types';
import { ModelsApiError, ModelsService } from './models.service';

interface PopulateOptions {
  /** '' means every registered CSV. */
  target: string;
  batchSize: number | null;
  workers: number | null;
}

/** Kept in step with BATCH_SIZE_RANGE and WORKERS_RANGE in src/api/import-route.ts. */
const BATCH_SIZE = { min: 1, max: 100_000 };
const WORKERS = { min: 1, max: 64 };
const ERRORS_SHOWN = 20;

@Component({
  selector: 'app-populate-panel',
  imports: [
    FormField,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatTableModule,
  ],
  templateUrl: './populate-panel.html',
  styleUrl: './populate-panel.scss',
})
export class PopulatePanel {
  private models = inject(ModelsService);

  /** Registered CSV filenames. */
  readonly files = input.required<string[]>();

  protected readonly batchSizeRange = BATCH_SIZE;
  protected readonly workersRange = WORKERS;
  protected readonly columns = ['model', 'inserted', 'duplicates', 'rejected'];

  private readonly model = signal<PopulateOptions>({ target: '', batchSize: 1000, workers: 4 });
  protected readonly options = form(this.model, (path) => {
    required(path.batchSize, { message: 'Enter a batch size' });
    min(path.batchSize, BATCH_SIZE.min, { message: `At least ${BATCH_SIZE.min}` });
    max(path.batchSize, BATCH_SIZE.max, { message: `At most ${BATCH_SIZE.max}` });
    required(path.workers, { message: 'Enter a number of workers' });
    min(path.workers, WORKERS.min, { message: `At least ${WORKERS.min}` });
    max(path.workers, WORKERS.max, { message: `At most ${WORKERS.max}` });
  });

  protected readonly result = signal<ImportResult | null>(null);
  protected readonly failure = signal<{ message: string; details?: string } | null>(null);
  protected readonly shownErrors = computed(
    () => this.result()?.errors.slice(0, ERRORS_SHOWN) ?? [],
  );
  protected readonly hiddenErrorCount = computed(() =>
    Math.max(0, (this.result()?.errors.length ?? 0) - ERRORS_SHOWN),
  );

  protected async populate(event: Event): Promise<void> {
    event.preventDefault();
    await submit(this.options, {
      action: async () => {
        const { target, batchSize, workers } = this.model();
        this.result.set(null);
        this.failure.set(null);
        try {
          const result = await firstValueFrom(
            this.models.populate({
              ...(target && { file: target }),
              batchSize: batchSize ?? BATCH_SIZE.min,
              workers: workers ?? WORKERS.min,
            }),
          );
          this.result.set(result);
        } catch (err: unknown) {
          const e = err as ModelsApiError;
          this.failure.set({ message: e.message, details: e.details });
        }
        return undefined;
      },
    });
  }
}
