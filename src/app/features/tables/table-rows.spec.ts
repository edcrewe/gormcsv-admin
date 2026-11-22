import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { RowsPage } from '../../../shared/api-types';
import { TableRows } from './table-rows';
import { expectNoAxeViolations } from '../../../testing/axe';

const PAGE: RowsPage = {
  table: 'countries',
  columns: ['id', 'name', 'alias'],
  rows: [
    [26, 'Chad', null],
    [27, 'Chile', 'Chile'],
  ],
  total: 245,
  limit: 25,
  offset: 25,
  order: 'id',
  desc: false,
};

describe('TableRows', () => {
  let httpTesting: HttpTestingController;
  let router: Router;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [TableRows],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    httpTesting = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    await router.navigateByUrl('/?view=rows');
  });

  afterEach(() => httpTesting.verify());

  interface Inputs {
    page?: unknown;
    size?: unknown;
    sort?: string;
    direction?: string;
  }

  /** Renders, lets httpResource request, then answers with page (or an error). */
  async function render(inputs: Inputs = {}, page: RowsPage | 'error' = PAGE) {
    const fixture = TestBed.createComponent(TableRows);
    fixture.componentRef.setInput('table', 'countries');
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
    await Promise.resolve();
    const req = httpTesting.expectOne((r) => r.url.startsWith('/api/tables/'));
    if (page === 'error') {
      req.flush(
        { ok: false, error: 'no column "nope" in "countries": not found' },
        { status: 400, statusText: 'Bad Request' },
      );
    } else {
      req.flush(page);
    }
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement, url: req.request.urlWithParams };
  }

  const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();
  const query = () => router.parseUrl(router.url).queryParams;

  it('asks for the first page of 25 by default', async () => {
    const { url } = await render();

    expect(url).toBe('/api/tables/countries/rows?limit=25&offset=0');
  });

  it('turns page, size, sort and direction into the request', async () => {
    const { url } = await render({ page: '2', size: '50', sort: 'name', direction: 'desc' });

    expect(url).toBe('/api/tables/countries/rows?limit=50&offset=100&sort=name&dir=desc');
  });

  it.each([
    [{ page: 'abc' }, 'limit=25&offset=0'],
    [{ page: '-3' }, 'limit=25&offset=0'],
    [{ size: '7' }, 'limit=25&offset=0'],
  ])('falls back to defaults for unusable query values %j', async (inputs, params) => {
    const { url } = await render(inputs);

    expect(url).toBe(`/api/tables/countries/rows?${params}`);
  });

  it('escapes the table name in the request path', async () => {
    const fixture = TestBed.createComponent(TableRows);
    fixture.componentRef.setInput('table', 'odd/name');
    fixture.detectChanges();
    await Promise.resolve();

    httpTesting.expectOne('/api/tables/odd%2Fname/rows?limit=25&offset=0').flush(PAGE);
  });

  it('shows the columns from the response, the rows, nulls, and the range', async () => {
    const { el } = await render();

    expect(Array.from(el.querySelectorAll('th')).map((th) => text(th))).toEqual([
      'id',
      'name',
      'alias',
    ]);
    const rows = Array.from(el.querySelectorAll('tbody tr')).map((tr) =>
      Array.from(tr.querySelectorAll('td')).map((td) => text(td)),
    );
    expect(rows).toEqual([
      ['26', 'Chad', 'null'],
      ['27', 'Chile', 'Chile'],
    ]);
    expect(el.querySelector('td .null')).not.toBeNull();
    expect(text(el.querySelector('.range'))).toBe('Rows 26–27 of 245');
  });

  it('says when there are no rows', async () => {
    const { el } = await render({}, { ...PAGE, rows: [], total: 0, offset: 0 });

    expect(text(el.querySelector('.range'))).toBe('No rows');
  });

  it('explains a page past the end of the table, rather than an impossible range', async () => {
    const { el } = await render({ page: '40' }, { ...PAGE, rows: [], offset: 1000 });

    expect(text(el.querySelector('.range'))).toBe(
      'No rows on this page; the table has 245. Use First page to go back.',
    );
    expect(el.querySelector('button.mat-mdc-paginator-navigation-first')).not.toBeNull();
  });

  it('keeps a huge page number within the offsets the API accepts', async () => {
    const { url } = await render({ page: '1e400', size: '100' });

    expect(url).toBe('/api/tables/countries/rows?limit=100&offset=0');
  });

  it('shows a large integer exactly as the API sends it', async () => {
    const { el } = await render({}, { ...PAGE, rows: [['9007199254740993', 'Big', null]] });

    expect(text(el.querySelector('tbody td'))).toBe('9007199254740993');
  });

  it('marks the sorted column for assistive technology', async () => {
    const { el } = await render({ sort: 'name', direction: 'desc' });

    const sorted = Array.from(el.querySelectorAll('th')).find((th) => text(th) === 'name')!;
    expect(sorted.getAttribute('aria-sort')).toBe('descending');
  });

  it('sorting navigates: ascending, then descending, then off, back to the first page', async () => {
    const { fixture, el } = await render({ page: '3' });
    await router.navigate([], { queryParams: { page: 3 }, queryParamsHandling: 'merge' });
    const header = () =>
      Array.from(el.querySelectorAll<HTMLElement>('th')).find((th) => text(th) === 'name')!;
    const click = async () => {
      header().querySelector<HTMLElement>('.mat-sort-header-container')!.click();
      await fixture.whenStable();
    };

    await click();
    expect(query()).toEqual({ view: 'rows', sort: 'name' });
    await click();
    expect(query()).toEqual({ view: 'rows', sort: 'name', dir: 'desc' });
    await click();
    expect(query()).toEqual({ view: 'rows' });
  });

  it('the paginator navigates to the next page and to a new page size', async () => {
    const { fixture, el } = await render({ page: '1' });

    el.querySelector<HTMLButtonElement>('button.mat-mdc-paginator-navigation-next')!.click();
    await fixture.whenStable();
    expect(query()).toEqual({ view: 'rows', page: '2' });

    el.querySelector<HTMLButtonElement>('button.mat-mdc-paginator-navigation-first')!.click();
    await fixture.whenStable();
    expect(query()).toEqual({ view: 'rows' });
  });

  it('refetches when an input changes', async () => {
    const { fixture } = await render();

    fixture.componentRef.setInput('page', '1');
    fixture.detectChanges();
    await Promise.resolve();

    httpTesting.expectOne('/api/tables/countries/rows?limit=25&offset=25').flush(PAGE);
  });

  it('shows the API error', async () => {
    const { el } = await render({ sort: 'nope' }, 'error');

    expect(text(el.querySelector('[role="alert"]'))).toContain('no column "nope"');
    expect(el.querySelector('table')).toBeNull();
  });

  it('puts the rows in a named, keyboard-scrollable region and passes AXE', async () => {
    const { el } = await render();

    const region = el.querySelector('[role="region"]')!;
    expect(region.getAttribute('aria-label')).toBe('Rows of countries');
    expect(region.getAttribute('tabindex')).toBe('0');
    await expectNoAxeViolations(el);
  });
});
