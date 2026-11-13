import { Component, input } from '@angular/core';
import { MatTableModule } from '@angular/material/table';
import { GoModel } from '../../../shared/api-types';

/** The fields gormcsv inferred for one model, with their Go types. */
@Component({
  selector: 'app-model-fields-table',
  imports: [MatTableModule],
  template: `
    <table mat-table [dataSource]="model().fields">
      <caption>
        {{
          model().name
        }}
        fields (factory key "{{
          model().key
        }}")
      </caption>
      <ng-container matColumnDef="name">
        <th mat-header-cell *matHeaderCellDef scope="col">Field</th>
        <td mat-cell *matCellDef="let field">{{ field.name }}</td>
      </ng-container>
      <ng-container matColumnDef="type">
        <th mat-header-cell *matHeaderCellDef scope="col">Go type</th>
        <td mat-cell *matCellDef="let field">
          <code>{{ field.type }}</code>
        </td>
      </ng-container>
      <tr mat-header-row *matHeaderRowDef="columns"></tr>
      <tr mat-row *matRowDef="let row; columns: columns"></tr>
    </table>
  `,
  styles: `
    table {
      max-width: 480px;
    }
    caption {
      text-align: left;
      padding: 8px 0;
      font: var(--mat-sys-title-small);
    }
  `,
})
export class ModelFieldsTable {
  readonly model = input.required<GoModel>();
  protected readonly columns = ['name', 'type'];
}
