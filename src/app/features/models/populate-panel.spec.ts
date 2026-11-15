import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ImportResult } from '../../../shared/api-types';
import { PopulatePanel } from './populate-panel';
import { expectNoAxeViolations } from '../../../testing/axe';

const PARTIAL: ImportResult = {
  complete: false,
  files: [
    { model: 'Country', inserted: 245, duplicates: 0, rejected: 1 },
    { model: 'TestTypes', inserted: 6, duplicates: 0, rejected: 0 },
  ],
  totals: { inserted: 251, duplicates: 0, rejected: 1 },
  errors: ['Country.csv row 148: record on line 148: wrong number of fields'],
  database: '/ws/gormcsv.db',
};

describe('PopulatePanel', () => {
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [PopulatePanel],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  async function render(files = ['Country.csv', 'TestTypes.csv']) {
    const fixture = TestBed.createComponent(PopulatePanel);
    fixture.componentRef.setInput('files', files);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const input = (label: string) =>
      Array.from(el.querySelectorAll('mat-form-field'))
        .find((f) => f.textContent?.includes(label))!
        .querySelector<HTMLInputElement>('input')!;
    const select = () => el.querySelector('select')!;
    const button = () => el.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const type = async (label: string, value: string) => {
      const field = input(label);
      field.value = value;
      field.dispatchEvent(new Event('input'));
      field.dispatchEvent(new Event('blur'));
      await fixture.whenStable();
    };
    // Browsers fire input then change on a select; Signal Forms listens for input.
    const choose = async (value: string) => {
      select().value = value;
      select().dispatchEvent(new Event('input'));
      select().dispatchEvent(new Event('change'));
      await fixture.whenStable();
    };
    // submit() runs its action after a few promise hops, so let those settle before asserting.
    const settle = async () => {
      await new Promise((resolve) => setTimeout(resolve));
      await fixture.whenStable();
    };
    const submit = async () => {
      button().click();
      await settle();
    };
    const respond = async (
      ...args: Parameters<ReturnType<HttpTestingController['expectOne']>['flush']>
    ) => {
      httpTesting.expectOne('/api/import').flush(...args);
      await settle();
    };
    return { fixture, el, input, select, button, type, choose, submit, respond };
  }

  it('offers all CSVs or one, with default batch size and workers', async () => {
    const { el, input } = await render();

    expect(Array.from(el.querySelectorAll('option')).map((o) => o.textContent?.trim())).toEqual([
      'All registered CSVs',
      'Country.csv',
      'TestTypes.csv',
    ]);
    expect(input('Batch size').value).toBe('1000');
    expect(input('Workers').value).toBe('4');
    expect(el.textContent).toContain('Importing again adds the rows again');
  });

  it('imports every registered CSV when none is chosen', async () => {
    const { submit } = await render();

    await submit();

    const req = httpTesting.expectOne({ method: 'POST', url: '/api/import' });
    expect(req.request.body).toEqual({ batchSize: 1000, workers: 4 });
    req.flush(PARTIAL);
  });

  it('sends the chosen CSV and the typed options', async () => {
    const { choose, type, submit } = await render();

    await choose('TestTypes.csv');
    await type('Batch size', '250');
    await type('Workers', '1');
    await submit();

    const req = httpTesting.expectOne('/api/import');
    expect(req.request.body).toEqual({ file: 'TestTypes.csv', batchSize: 250, workers: 1 });
    req.flush(PARTIAL);
  });

  it.each([
    ['Batch size', '0', 'At least 1'],
    ['Batch size', '100001', 'At most 100000'],
    ['Batch size', '', 'Enter a batch size'],
    ['Workers', '0', 'At least 1'],
    ['Workers', '65', 'At most 64'],
  ])('blocks submit and explains when %s is %j', async (label, value, message) => {
    const { el, input, type, submit } = await render();

    await type(label, value);
    await submit();

    httpTesting.expectNone('/api/import');
    expect(el.querySelector('mat-error')?.textContent?.trim()).toBe(message);
    // Material leaves aria-invalid off for an empty required field; aria-required covers it.
    const expected = value === '' ? { 'aria-required': 'true' } : { 'aria-invalid': 'true' };
    const [attr, attrValue] = Object.entries(expected)[0];
    expect(input(label).getAttribute(attr)).toBe(attrValue);
  });

  it('shows progress and disables Import while the request is pending', async () => {
    const { el, button, submit, respond } = await render();

    await submit();

    expect(el.querySelector('mat-progress-bar')?.getAttribute('aria-label')).toBe('Importing');
    expect(button().disabled).toBe(true);
    await respond(PARTIAL);
    expect(el.querySelector('mat-progress-bar')).toBeNull();
    expect(button().disabled).toBe(false);
  });

  it('summarises a partial import with per-model counts and the rejected rows', async () => {
    const { el, submit, respond } = await render();
    await submit();

    await respond(PARTIAL);

    const summary = el.querySelector('[role="status"] .summary')!;
    expect(summary.classList).toContain('partial');
    expect(summary.textContent).toContain('Partly imported');
    expect(summary.textContent).toContain('251 rows inserted');
    expect(summary.textContent).toContain('1 rejected');
    expect(summary.textContent).toContain('/ws/gormcsv.db');
    const rows = Array.from(el.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim()),
    );
    expect(rows).toEqual([
      ['Country', '245', '0', '1'],
      ['TestTypes', '6', '0', '0'],
    ]);
    expect(el.querySelector('.errors li')?.textContent).toContain('row 148');
    await expectNoAxeViolations(el);
  });

  it('marks a complete import as such, with no error list', async () => {
    const { el, submit, respond } = await render();
    await submit();

    await respond({
      ...PARTIAL,
      complete: true,
      errors: [],
      totals: { ...PARTIAL.totals, rejected: 0 },
    });

    const summary = el.querySelector('.summary')!;
    expect(summary.classList).not.toContain('partial');
    expect(summary.textContent).toContain('Imported');
    expect(el.querySelector('.errors')).toBeNull();
  });

  it('shows the first 20 errors and counts the rest', async () => {
    const { el, submit, respond } = await render();
    await submit();

    const errors = Array.from({ length: 25 }, (_, i) => `Country.csv row ${i + 2}: bad`);
    await respond({ ...PARTIAL, errors });

    expect(el.querySelectorAll('.errors li')).toHaveLength(20);
    expect(el.textContent).toContain('and 5 more.');
  });

  it('alerts on a failed import, with details when the API gives them', async () => {
    const { el, submit, respond } = await render();
    await submit();

    await respond(
      { ok: false, error: 'Import failed', details: 'disk full' },
      { status: 500, statusText: 'Error' },
    );

    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Import failed');
    expect(el.querySelector('details pre')?.textContent).toBe('disk full');
    expect(el.querySelector('.summary')).toBeNull();
    await expectNoAxeViolations(el);
  });

  it('clears the previous result when importing again', async () => {
    const { el, submit, respond } = await render();
    await submit();
    await respond(PARTIAL);

    await submit();

    expect(el.querySelector('.summary')).toBeNull();
    await respond(PARTIAL);
    expect(el.querySelector('.summary')).not.toBeNull();
  });
});
