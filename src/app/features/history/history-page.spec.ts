import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { HistoryPage as HistoryPageData } from '../../../shared/api-types';
import { HistoryPage } from './history-page';
import { expectNoAxeViolations } from '../../../testing/axe';

const DATA: HistoryPageData = {
  entries: [
    {
      at: '2026-11-21T15:45:15.000Z',
      action: 'import',
      outcome: 'partial',
      database: { driver: 'sqlite', dsn: '/ws/gormcsv.db' },
      totals: { inserted: 245, duplicates: 0, rejected: 1 },
      errors: ['Country.csv row 148: wrong number of fields'],
    },
    {
      at: '2026-11-21T15:40:00.000Z',
      action: 'register',
      outcome: 'failed',
      file: 'BadQuotes.csv',
      message: 'inspect "BadQuotes.csv": parse error',
    },
  ],
  total: 30,
  limit: 25,
  offset: 0,
};

describe('HistoryPage', () => {
  let httpTesting: HttpTestingController;
  let router: Router;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [HistoryPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    httpTesting = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    await router.navigateByUrl('/');
  });

  afterEach(() => httpTesting.verify());

  async function render(
    inputs: Record<string, unknown> = {},
    respond: (req: ReturnType<HttpTestingController['expectOne']>) => void = (req) =>
      req.flush(DATA),
  ) {
    const fixture = TestBed.createComponent(HistoryPage);
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
    await Promise.resolve();
    const req = httpTesting.expectOne((r) => r.url.startsWith('/api/history'));
    const url = req.request.urlWithParams;
    respond(req);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement, url };
  }

  const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();

  it('requests the first page by default', async () => {
    expect((await render()).url).toBe('/api/history?limit=25&offset=0');
  });

  it('asks for a later page from the page and size inputs', async () => {
    const { url } = await render({ page: '2', size: '10' });

    expect(url).toBe('/api/history?limit=10&offset=20');
  });

  it('shows each entry: action, CSV, outcome, rows and details', async () => {
    const { el } = await render();

    expect(text(el.querySelector('caption'))).toBe('30 entries');
    const rows = Array.from(el.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => text(td)),
    );
    expect(rows[0].slice(1, 5)).toEqual([
      'Imported',
      'All registered CSVs',
      'warning partial',
      '245 inserted, 0 skipped, 1 rejected',
    ]);
    expect(rows[0][5]).toContain('sqlite /ws/gormcsv.db');
    expect(rows[0][5]).toContain('1 message');
    expect(rows[1].slice(1, 5)).toEqual(['Registered', 'BadQuotes.csv', 'error failed', '']);
    expect(rows[1][5]).toBe('inspect "BadQuotes.csv": parse error');
    expect(el.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-21T15:45:15.000Z');
    await expectNoAxeViolations(el);
  });

  it('points to the Import page when the log is empty', async () => {
    const { el } = await render({}, (req) => req.flush({ ...DATA, entries: [], total: 0 }));

    expect(text(el)).toContain('Nothing yet.');
    expect(el.querySelector('a[href="/import"]')).not.toBeNull();
    expect(el.querySelector('table')).toBeNull();
  });

  it('shows the API error', async () => {
    const { el } = await render({}, (req) =>
      req.flush(
        { ok: false, error: 'Reading the history failed' },
        { status: 500, statusText: 'Error' },
      ),
    );

    expect(text(el.querySelector('[role="alert"]'))).toBe('Reading the history failed');
  });

  it('the paginator navigates through the URL', async () => {
    const { fixture, el } = await render();

    el.querySelector<HTMLButtonElement>('button.mat-mdc-paginator-navigation-next')!.click();
    await fixture.whenStable();

    expect(router.parseUrl(router.url).queryParams).toEqual({ page: '1' });
  });
});
