import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { InspectResult } from '../../../shared/api-types';
import { CodePanel } from '../../shared/code-panel';
import { InspectService } from './inspect.service';
import { ModelFieldsTable } from '../../shared/model-fields-table';
import { RegisterModel } from './register-model';

type InspectState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; result: InspectResult }
  | { kind: 'error'; message: string };

@Component({
  selector: 'app-import-page',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    CodePanel,
    ModelFieldsTable,
    RegisterModel,
  ],
  templateUrl: './import-page.html',
  styleUrl: './import-page.scss',
})
export class ImportPage {
  private inspectService = inject(InspectService);
  private injector = inject(Injector);
  private resultsHeading = viewChild<ElementRef<HTMLElement>>('resultsHeading');

  protected readonly file = signal<File | null>(null);
  protected readonly state = signal<InspectState>({ kind: 'idle' });
  protected readonly loading = computed(() => this.state().kind === 'loading');
  protected readonly canInspect = computed(() => this.file() !== null && !this.loading());
  // Narrow the state union here so the template stays simple.
  protected readonly result = computed(() => {
    const s = this.state();
    return s.kind === 'done' ? s.result : null;
  });
  protected readonly errorMessage = computed(() => {
    const s = this.state();
    return s.kind === 'error' ? s.message : null;
  });

  protected onFileChange(input: HTMLInputElement): void {
    this.file.set(input.files?.item(0) ?? null);
    this.state.set({ kind: 'idle' });
    // Clear so choosing the same file again still fires a change event.
    input.value = '';
  }

  protected inspect(): void {
    const file = this.file();
    if (!file || this.loading()) return;
    this.state.set({ kind: 'loading' });
    this.inspectService.inspect(file).subscribe({
      next: (result) => {
        this.state.set({ kind: 'done', result });
        // Move focus to the new content so keyboard and screen reader users land on the result.
        afterNextRender(() => this.resultsHeading()?.nativeElement.focus(), {
          injector: this.injector,
        });
      },
      error: (err: Error) => this.state.set({ kind: 'error', message: err.message }),
    });
  }
}
