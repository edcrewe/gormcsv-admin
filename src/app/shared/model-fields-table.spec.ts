import { TestBed } from '@angular/core/testing';
import { GoModel } from '../../shared/api-types';
import { ModelFieldsTable } from './model-fields-table';
import { expectNoAxeViolations } from '../../testing/axe';

const MODEL: GoModel = {
  name: 'OrderItem',
  key: 'order-item',
  fields: [
    { name: 'Name', type: 'string' },
    { name: 'UnitPrice', type: 'float64' },
  ],
};

describe('ModelFieldsTable', () => {
  async function render(model = MODEL) {
    const fixture = TestBed.createComponent(ModelFieldsTable);
    fixture.componentRef.setInput('model', model);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('captions the table with the model name and factory key', async () => {
    const { el } = await render();

    expect(el.querySelector('caption')?.textContent).toContain('OrderItem fields');
    expect(el.querySelector('caption')?.textContent).toContain('"order-item"');
  });

  it('renders one row per field with its Go type', async () => {
    const { el } = await render();

    const rows = Array.from(el.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim()),
    );
    expect(rows).toEqual([
      ['Name', 'string'],
      ['UnitPrice', 'float64'],
    ]);
  });

  it('updates when the model input changes', async () => {
    const { fixture, el } = await render();

    fixture.componentRef.setInput('model', { ...MODEL, fields: [{ name: 'Only', type: 'bool' }] });
    await fixture.whenStable();

    expect(el.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('uses column header scopes and passes AXE', async () => {
    const { el } = await render();

    expect(Array.from(el.querySelectorAll('th')).map((th) => th.getAttribute('scope'))).toEqual([
      'col',
      'col',
    ]);
    await expectNoAxeViolations(el);
  });
});
