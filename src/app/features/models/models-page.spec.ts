import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { WorkspaceStatus } from '../../../shared/api-types';
import { ModelsPage } from './models-page';
import { expectNoAxeViolations } from '../../../testing/axe';

const BUILT: WorkspaceStatus = {
  ready: true,
  files: ['Country.csv', 'TestTypes.csv'],
  models: [
    { name: 'Country', key: 'country', fields: [{ name: 'Name', type: 'string' }] },
    { name: 'TestTypes', key: 'testtypes', fields: [{ name: 'Intcol', type: 'int16' }] },
  ],
  binary: { version: 'v0.3.1-4-g5ad9de4-dirty', builtAt: '2026-11-13T11:10:04.849Z' },
};

describe('ModelsPage', () => {
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ModelsPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  /** Renders, lets httpResource send its request, then answers it. */
  async function renderWith(
    respond: (req: ReturnType<HttpTestingController['expectOne']>) => void,
  ) {
    const fixture = TestBed.createComponent(ModelsPage);
    fixture.detectChanges();
    await Promise.resolve();
    const el = fixture.nativeElement as HTMLElement;
    const loading = !!el.querySelector('mat-progress-bar');
    respond(httpTesting.expectOne('/api/models'));
    await fixture.whenStable();
    return { fixture, el, loading };
  }

  it('shows a progress bar while loading', async () => {
    const { loading } = await renderWith((req) => req.flush(BUILT));

    expect(loading).toBe(true);
  });

  it('lists the binary version, build time, CSV files and every model', async () => {
    const { el } = await renderWith((req) => req.flush(BUILT));

    const dds = Array.from(el.querySelectorAll('dd')).map((dd) => dd.textContent?.trim());
    expect(dds[0]).toBe('v0.3.1-4-g5ad9de4-dirty');
    expect(dds[1]).toMatch(/2026/);
    expect(dds[2]).toBe('Country.csv, TestTypes.csv');
    expect(el.querySelector('#registered-heading')?.textContent?.trim()).toBe(
      '2 registered models',
    );
    expect(el.querySelectorAll('app-model-fields-table')).toHaveLength(2);
    expect(el.querySelector('mat-progress-bar')).toBeNull();
    await expectNoAxeViolations(el);
  });

  it('uses the singular for one model', async () => {
    const { el } = await renderWith((req) => req.flush({ ...BUILT, models: [BUILT.models[0]] }));

    expect(el.querySelector('#registered-heading')?.textContent?.trim()).toBe('1 registered model');
  });

  it('explains an empty workspace and links to Import', async () => {
    const { el } = await renderWith((req) =>
      req.flush({ ready: true, files: [], models: [], binary: null }),
    );

    expect(el.textContent).toContain('Not built yet. Register a model to build it.');
    expect(el.querySelector('#registered-heading')).toBeNull();
    expect(el.querySelector('a[href="/import"]')).not.toBeNull();
  });

  it('alerts when the gormcsv checkout is missing', async () => {
    const { el } = await renderWith((req) =>
      req.flush({
        ready: false,
        problem: 'No gormcsv source checkout at /home/x/gormcsv-src',
        files: [],
        models: [],
        binary: null,
      }),
    );

    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      'No gormcsv source checkout at /home/x/gormcsv-src',
    );
  });

  it('shows the API error when loading fails', async () => {
    const { el } = await renderWith((req) =>
      req.flush(
        { ok: false, error: 'Reading the workspace failed' },
        { status: 500, statusText: 'Error' },
      ),
    );

    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      'Reading the workspace failed',
    );
  });

  it('reloads on Refresh', async () => {
    const { fixture, el } = await renderWith((req) =>
      req.flush({ ready: true, files: [], models: [], binary: null }),
    );

    Array.from(el.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Refresh'))!
      .click();
    fixture.detectChanges();
    await Promise.resolve();
    httpTesting.expectOne('/api/models').flush(BUILT);
    await fixture.whenStable();

    expect(el.querySelectorAll('app-model-fields-table')).toHaveLength(2);
  });
});
