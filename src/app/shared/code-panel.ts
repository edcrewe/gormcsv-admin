/**
 * Reusable read-only code block with a copy button, used for the generated models.go. code and
 * label are signal inputs (input.required() and input()), which the template reads like any other
 * signal. Copying uses the CDK cdkCopyToClipboard directive. Its copied event sets a signal that is
 * shown in a polite live region, so screen readers announce "Copied". The pre element is focusable,
 * so keyboard users can scroll long code.
 */

import { Component, input, signal } from '@angular/core';
import { CdkCopyToClipboard } from '@angular/cdk/clipboard';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

/** Read-only source code block with a copy button. */
@Component({
  selector: 'app-code-panel',
  imports: [CdkCopyToClipboard, MatButtonModule, MatIconModule],
  template: `
    <div class="header">
      <span class="label">{{ label() }}</span>
      <button
        matButton
        type="button"
        [cdkCopyToClipboard]="code()"
        (cdkCopyToClipboardCopied)="copied.set($event)"
      >
        <mat-icon aria-hidden="true">content_copy</mat-icon>
        Copy {{ label() }}
      </button>
      <span class="copied" role="status" aria-live="polite">{{ copied() ? 'Copied' : '' }}</span>
    </div>
    <pre tabindex="0" [attr.aria-label]="label()"><code>{{ code() }}</code></pre>
  `,
  styles: `
    .header {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .label {
      font: var(--mat-sys-title-small);
    }
    .copied {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }
    pre {
      margin: 8px 0 0;
      padding: 12px 16px;
      overflow: auto;
      max-height: 480px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container);
      color: var(--mat-sys-on-surface);
      font-size: 13px;
    }
    pre:focus-visible {
      outline: 2px solid var(--mat-sys-primary);
    }
  `,
})
export class CodePanel {
  readonly code = input.required<string>();
  readonly label = input('code');
  protected readonly copied = signal(false);
}
