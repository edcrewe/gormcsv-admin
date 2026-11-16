import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TablesResponse } from '../../../shared/api-types';
import { TablesPage } from './tables-page';
import { expectNoAxeViolations } from '../../../testing/axe';

const DATA: TablesResponse = {
  database: { driver: 'postgres', dsn: 'postgres://ed:***@db/admin' },
  tables: [
    {
      name: 'countries',
      rows: 245,
      columns: [
        { name: 'id', type: 'bigint', nullable: false, primaryKey: true },
        { name: 'code', type: 'text', nullable: true, primaryKey: false },
      ],
      indexes: [
        { name: 'idx_countries_code', columns: ['code'], unique: true },
        { name: 'idx_countries_deleted_at', columns: ['deleted_at'], unique: false },
      ],
    },
    { name: 'notes', rows: 1, columns: [], indexes: [] },
  ],
};

describe('TablesPage', () => {
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TablesPage],
      providers: [
        provideRouter(
          [
            { path: 'tables', component: TablesPage },
            { path: 'tables/:name', component: TablesPage },
          ],
          withComponentInputBinding(),
        ),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  /** Renders with an optional selected table, lets httpResource request, then answers it. */
  async function render(
    name: string | undefined,
    respond: (req: ReturnType<HttpTestingController['expectOne']>) => void = (req) =>
      req.flush(DATA),
  ) {
    const fixture = TestBed.createComponent(TablesPage);
    fixture.componentRef.setInput('name', name);
    fixture.detectChanges();
    await Promise.resolve();
    const el = fixture.nativeElement as HTMLElement;
    const loading = !!el.querySelector('mat-progress-bar');
    respond(httpTesting.expectOne('/api/tables'));
    await fixture.whenStable();
    return { fixture, el, loading };
  }

  const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();

  it('shows a progress bar, then the masked database and a link per table with its row count', async () => {
    const { el, loading } = await render(undefined);

    expect(loading).toBe(true);
    expect(el.querySelector('mat-progress-bar')).toBeNull();
    expect(text(el.querySelector('p'))).toBe('Tables in postgres postgres://ed:***@db/admin.');
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Tables"] a'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/tables/countries',
      '/tables/notes',
    ]);
    expect(
      links.map((a) => [
        text(a.querySelector('[matListItemTitle]')),
        text(a.querySelector('[matListItemLine]')),
      ]),
    ).toEqual([
      ['countries', '245 rows'],
      ['notes', '1 row'],
    ]);
    expect(text(el.querySelector('.detail'))).toBe(
      'Choose a table to see its columns and indexes.',
    );
  });

  it('shows the selected table: row count, columns in order, and indexes', async () => {
    const { el } = await render('countries');

    expect(text(el.querySelector('.detail h3'))).toBe('countries');
    expect(text(el.querySelector('.detail p'))).toBe('245 rows, 2 columns.');
    const rows = Array.from(el.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => text(td)),
    );
    expect(rows).toEqual([
      ['id', 'bigint', 'no', 'yes'],
      ['code', 'text', 'yes', ''],
    ]);
    expect(Array.from(el.querySelectorAll('.indexes li')).map((li) => text(li))).toEqual([
      'idx_countries_code on code (unique)',
      'idx_countries_deleted_at on deleted_at',
    ]);
    await expectNoAxeViolations(el);
  });

  it('shows the Columns tab by default and offers Rows', async () => {
    const { el } = await render('countries');

    const tabs = Array.from(el.querySelectorAll('nav[aria-label="Table views"] a'));
    expect(tabs.map((a) => text(a))).toEqual(['Columns', 'Rows']);
    expect(tabs[0].classList).toContain('mdc-tab--active');
    expect(tabs[1].getAttribute('href')).toBe('/?view=rows');
    expect(el.querySelector('app-table-rows')).toBeNull();
    expect(el.querySelector('.detail table caption')).not.toBeNull();
  });

  it('shows the rows of the table when view is rows, passing paging and sort through', async () => {
    const fixture = TestBed.createComponent(TablesPage);
    for (const [input, value] of Object.entries({
      name: 'countries',
      view: 'rows',
      page: '2',
      size: '10',
      sort: 'name',
      dir: 'desc',
    })) {
      fixture.componentRef.setInput(input, value);
    }
    fixture.detectChanges();
    await Promise.resolve();
    httpTesting.expectOne('/api/tables').flush(DATA);
    // The rows view then loads its page, which keeps the fixture unstable until answered.
    const rowRequests: string[] = [];
    const stable = fixture.whenStable();
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve));
      httpTesting
        .match((r) => r.url.includes('/rows'))
        .forEach((req) => {
          rowRequests.push(req.request.urlWithParams);
          req.flush({ table: 'countries', columns: ['id'], rows: [], total: 245 });
        });
    }
    await stable;

    expect(rowRequests).toEqual([
      '/api/tables/countries/rows?limit=10&offset=20&sort=name&dir=desc',
    ]);
    const el = fixture.nativeElement as HTMLElement;
    expect(
      el.querySelector('nav[aria-label="Table views"] a.mdc-tab--active')?.textContent?.trim(),
    ).toBe('Rows');
    expect(el.querySelector('app-table-rows')).not.toBeNull();
  });

  it('says when a table has no indexes', async () => {
    const { el } = await render('notes');

    expect(text(el.querySelector('.detail h4'))).toBe('Indexes');
    expect(text(el.querySelector('.detail h4 + p'))).toBe('None.');
  });

  it('alerts when the URL names a table that does not exist', async () => {
    const { el } = await render('missing');

    expect(text(el.querySelector('.detail [role="alert"]'))).toBe(
      'There is no table named missing.',
    );
  });

  it('points to the Models page when the database has no tables', async () => {
    const { el } = await render(undefined, (req) => req.flush({ ...DATA, tables: [] }));

    expect(text(el)).toContain('No tables yet. Populate one from the Models page.');
    expect(el.querySelector('a[href="/models"]')).not.toBeNull();
    expect(el.querySelector('nav')).toBeNull();
  });

  it('shows the API error when the tables cannot be listed', async () => {
    const { el } = await render(undefined, (req) =>
      req.flush(
        { ok: false, error: 'open postgres database: password authentication failed' },
        { status: 502, statusText: 'Bad Gateway' },
      ),
    );

    expect(text(el.querySelector('[role="alert"]'))).toContain('password authentication failed');
  });

  it('reloads on Refresh', async () => {
    const { fixture, el } = await render(undefined, (req) => req.flush({ ...DATA, tables: [] }));

    Array.from(el.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Refresh'))!
      .click();
    fixture.detectChanges();
    await Promise.resolve();
    httpTesting.expectOne('/api/tables').flush(DATA);
    await fixture.whenStable();

    expect(el.querySelectorAll('nav a')).toHaveLength(2);
  });

  it('selects the table named in the URL through route input binding', async () => {
    const harness = await RouterTestingHarness.create();
    const navigation = harness.navigateByUrl('/tables/countries', TablesPage);
    await new Promise((resolve) => setTimeout(resolve));
    httpTesting.expectOne('/api/tables').flush(DATA);
    const page = await navigation;
    await harness.fixture.whenStable();

    const el = harness.routeNativeElement!;
    expect(text(el.querySelector('.detail h3'))).toBe('countries');
    expect(el.querySelector('a[href="/tables/countries"]')?.getAttribute('aria-current')).toBe(
      'page',
    );
    expect(page).toBeInstanceOf(TablesPage);
  });
});
