import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { RegisterResult } from '../../../shared/api-types';
import { RegisterModel } from './register-model';
import { expectNoAxeViolations } from '../../../testing/axe';

const RESULT: RegisterResult = {
  file: 'Country.csv',
  warnings: ['Country.csv: skipped 1 row with the wrong number of fields (line 148)'],
  status: {
    ready: true,
    files: ['Country.csv', 'TestTypes.csv'],
    models: [
      { name: 'Country', key: 'country', fields: [] },
      { name: 'TestTypes', key: 'testtypes', fields: [] },
    ],
    binary: { version: 'v0.3.1-4-g5ad9de4-dirty', builtAt: '2026-11-13T11:10:04.849Z' },
    duplicates: {},
    database: { driver: 'sqlite', dsn: '/ws/gormcsv.db' },
  },
};

describe('RegisterModel', () => {
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RegisterModel],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  async function render() {
    const fixture = TestBed.createComponent(RegisterModel);
    fixture.componentRef.setInput('file', new File(['a\n'], 'Country.csv'));
    fixture.componentRef.setInput('modelName', 'Country');
    fixture.componentRef.setInput('columns', ['name', 'code', 'alias']);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const button = () =>
      Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Register'))!;
    const register = async () => {
      button().click();
      await fixture.whenStable();
    };
    const chooseMode = async (mode: string) => {
      el.querySelector<HTMLInputElement>(`mat-radio-button[value="${mode}"] input`)!.click();
      await fixture.whenStable();
    };
    const toggleColumn = async (column: string) => {
      const box = Array.from(el.querySelectorAll('.key-columns mat-checkbox')).find(
        (c) => c.textContent?.trim() === column,
      )!;
      box.querySelector('input')!.click();
      await fixture.whenStable();
    };
    const sentFields = (req: ReturnType<HttpTestingController['expectOne']>) => {
      const body = req.request.body as FormData;
      return { duplicates: body.get('duplicates'), keyColumns: body.getAll('keyColumn') };
    };
    return { fixture, el, button, register, chooseMode, toggleColumn, sentFields };
  }

  it('offers to register the inspected model and explains the rebuild', async () => {
    const { el, button } = await render();

    expect(el.querySelector('h3')?.textContent).toContain('2. Register the model');
    expect(el.textContent).toContain('adds Country.csv to the workspace');
    expect(button().textContent?.trim()).toBe('Register Country');
    expect(button().disabled).toBe(false);
  });

  it('shows build progress and blocks a second click while registering', async () => {
    const { el, button, register } = await render();

    await register();

    httpTesting.expectOne('/api/models');
    expect(el.querySelector('mat-progress-bar')?.getAttribute('aria-label')).toBe(
      'Building gormcsv',
    );
    expect(button().disabled).toBe(true);
  });

  it('announces success with the new version, model list, warnings and a Models link', async () => {
    const { fixture, el, button, register } = await render();
    await register();

    httpTesting.expectOne('/api/models').flush(RESULT);
    await fixture.whenStable();

    const status = el.querySelector('[role="status"]')!;
    expect(status.textContent).toContain('Registered Country.csv');
    expect(status.textContent).toContain('gormcsv v0.3.1-4-g5ad9de4-dirty');
    expect(status.textContent).toContain('import Country, TestTypes');
    expect(status.querySelector('a')?.getAttribute('href')).toBe('/models');
    expect(status.querySelector('li')?.textContent).toContain('line 148');
    expect(el.querySelector('mat-progress-bar')).toBeNull();
    expect(button().disabled).toBe(false);
    await expectNoAxeViolations(el);
  });

  it('shows the failure, says the workspace is unchanged, and reveals build output', async () => {
    const { fixture, el, register } = await render();
    await register();

    httpTesting
      .expectOne('/api/models')
      .flush(
        { ok: false, error: 'go build failed', details: 'models.go:12:2: undefined: Bogus' },
        { status: 500, statusText: 'Error' },
      );
    await fixture.whenStable();

    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      'go build failed. The workspace was left unchanged.',
    );
    expect(el.querySelector('details summary')?.textContent).toBe('Build output');
    expect(el.querySelector('details pre')?.textContent).toBe('models.go:12:2: undefined: Bogus');
    await expectNoAxeViolations(el);
  });

  it('omits the build output panel when there are no details', async () => {
    const { fixture, el, register } = await render();
    await register();

    httpTesting
      .expectOne('/api/models')
      .flush(
        { ok: false, error: 'No gormcsv source checkout at /x' },
        { status: 503, statusText: '' },
      );
    await fixture.whenStable();

    expect(el.querySelector('[role="alert"]')).not.toBeNull();
    expect(el.querySelector('details')).toBeNull();
  });

  it('imports duplicates again by default and says so to the server', async () => {
    const { el, register, sentFields } = await render();

    expect(el.querySelector('mat-radio-button[value="allow"] input:checked')).not.toBeNull();
    expect(el.querySelector('.key-columns')).toBeNull();
    await register();

    const req = httpTesting.expectOne('/api/models');
    expect(sentFields(req)).toEqual({ duplicates: 'allow', keyColumns: [] });
    req.flush(RESULT);
  });

  it('needs at least one key column before it can register with a key', async () => {
    const { el, button, chooseMode, toggleColumn } = await render();

    await chooseMode('key');

    const boxes = Array.from(el.querySelectorAll('.key-columns mat-checkbox'));
    expect(boxes.map((b) => b.textContent?.trim())).toEqual(['name', 'code', 'alias']);
    expect(el.querySelector('.key-columns .hint')?.textContent).toContain('at least one');
    expect(button().disabled).toBe(true);

    await toggleColumn('code');
    expect(button().disabled).toBe(false);
    expect(el.querySelector('.key-columns .hint')).toBeNull();

    await toggleColumn('code');
    expect(button().disabled).toBe(true);
  });

  it('sends key columns in CSV order, whatever order they were ticked in', async () => {
    const { chooseMode, toggleColumn, register, sentFields } = await render();

    await chooseMode('key');
    await toggleColumn('alias');
    await toggleColumn('name');
    await register();

    const req = httpTesting.expectOne('/api/models');
    expect(sentFields(req)).toEqual({ duplicates: 'key', keyColumns: ['name', 'alias'] });
    req.flush(RESULT);
  });

  it('can skip identical rows instead', async () => {
    const { el, chooseMode, register, sentFields } = await render();

    await chooseMode('identical');
    expect(el.querySelector('.key-columns')).toBeNull();
    await register();

    const req = httpTesting.expectOne('/api/models');
    expect(sentFields(req)).toEqual({ duplicates: 'identical', keyColumns: [] });
    req.flush(RESULT);
  });

  it('groups the choice under a legend, warns about existing rows, and passes AXE', async () => {
    const { el, chooseMode } = await render();

    await chooseMode('key');

    expect(el.querySelector('fieldset legend')?.textContent).toContain(
      'When a row is already in the table',
    );
    expect(el.querySelector('#duplicates-note')?.textContent).toContain('empty it before');
    await expectNoAxeViolations(el);
  });
});
