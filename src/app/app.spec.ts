import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Title } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { MatSidenav } from '@angular/material/sidenav';
import { By } from '@angular/platform-browser';
import { App, NAV_ITEMS } from './app';
import { routerProviders } from './app.config';
import { expectNoAxeViolations } from '../testing/axe';
import { TablesResponse, WorkspaceStatus } from '../shared/api-types';

const EMPTY_WORKSPACE: WorkspaceStatus = {
  ready: true,
  files: [],
  models: [],
  binary: null,
  duplicates: {},
  database: { driver: 'sqlite', dsn: '/ws/gormcsv.db' },
};

const EMPTY_TABLES: TablesResponse = {
  database: { driver: 'sqlite', dsn: '/ws/gormcsv.db' },
  tables: [],
};

describe('App shell', () => {
  let httpTesting: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [routerProviders, provideHttpClient(), provideHttpClientTesting()],
    });
    httpTesting = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  // The status badge checks health on every render; answer it so verify() passes.
  afterEach(() => {
    httpTesting.match('/api/health').forEach((req) => req.flush({ ok: true }));
    httpTesting.verify();
  });

  // Pages that load data (Models, Tables via httpResource) keep the app unstable until answered.
  async function answerPageData(fixture: ComponentFixture<App>, tables = EMPTY_TABLES) {
    const stable = fixture.whenStable();
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve));
      httpTesting.match('/api/models').forEach((req) => req.flush(EMPTY_WORKSPACE));
      httpTesting.match('/api/tables').forEach((req) => req.flush(tables));
      httpTesting
        .match((r) => r.url.startsWith('/api/history'))
        .forEach((req) => req.flush({ entries: [], total: 0, limit: 25, offset: 0 }));
    }
    await stable;
  }

  async function renderAt(url: string) {
    const fixture = TestBed.createComponent(App);
    await router.navigateByUrl(url);
    await answerPageData(fixture);
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el };
  }

  it('renders the title and status badge in the toolbar', async () => {
    const { el } = await renderAt('/');

    expect(el.querySelector('mat-toolbar h1')?.textContent).toContain('gormcsv Admin');
    expect(el.querySelector('mat-toolbar app-cli-status-badge')).not.toBeNull();
  });

  it('renders one nav link per section', async () => {
    const { el } = await renderAt('/');

    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Main"] a'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual(NAV_ITEMS.map((i) => i.path));
    expect(links.map((a) => a.textContent?.trim())).toEqual(
      NAV_ITEMS.map((i) => expect.stringContaining(i.label)),
    );
  });

  it('redirects the root to Import and marks only that link as current', async () => {
    const { el } = await renderAt('/');

    expect(router.url).toBe('/import');
    expect(el.querySelector('main h2')?.textContent).toBe('Import CSV');
    const current = el.querySelectorAll('a[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0].getAttribute('href')).toBe('/import');
  });

  it.each([
    ['/import', 'Import CSV', 'Import CSV | gormcsv Admin'],
    ['/models', 'Models', 'Models | gormcsv Admin'],
    ['/tables', 'Tables', 'Tables | gormcsv Admin'],
    ['/tables/countries', 'Tables', 'Tables | gormcsv Admin'],
    ['/history', 'Import history', 'Import history | gormcsv Admin'],
    ['/no-such-page', 'Page not found', 'Not found | gormcsv Admin'],
  ])('lazy-loads %s with its heading and document title', async (url, heading, title) => {
    const { el } = await renderAt(url);

    expect(el.querySelector('main h2')?.textContent).toBe(heading);
    expect(TestBed.inject(Title).getTitle()).toBe(title);
  });

  it('binds /tables/:name to the Tables page, through the app router config', async () => {
    const fixture = TestBed.createComponent(App);
    await router.navigateByUrl('/tables/countries');
    await answerPageData(fixture, {
      ...EMPTY_TABLES,
      tables: [{ name: 'countries', rows: 3, columns: [], indexes: [] }],
    });

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('app-tables-page .detail h3')?.textContent?.trim()).toBe('countries');
  });

  it('follows a nav link click to the section', async () => {
    const { fixture, el } = await renderAt('/import');

    el.querySelector<HTMLAnchorElement>('a[href="/tables"]')?.click();
    await answerPageData(fixture);

    expect(router.url).toBe('/tables');
    expect(el.querySelector('a[href="/tables"]')?.getAttribute('aria-current')).toBe('page');
  });

  it('toggles the sidenav and its aria-expanded state', async () => {
    const { fixture, el } = await renderAt('/import');
    const toggle = el.querySelector<HTMLButtonElement>('button[aria-label="Toggle navigation"]')!;
    const sidenav = fixture.debugElement.query(By.directive(MatSidenav))
      .componentInstance as MatSidenav;

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(sidenav.opened).toBe(true);

    toggle.click();
    await fixture.whenStable();

    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(sidenav.opened).toBe(false);
  });

  it('passes AXE checks', async () => {
    const { fixture, el } = await renderAt('/import');
    httpTesting.expectOne('/api/health').flush({ ok: true });
    await fixture.whenStable();

    await expectNoAxeViolations(el);
  });
});
