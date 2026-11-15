import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Title } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { MatSidenav } from '@angular/material/sidenav';
import { By } from '@angular/platform-browser';
import { App, NAV_ITEMS } from './app';
import { routes } from './app.routes';
import { expectNoAxeViolations } from '../testing/axe';
import { WorkspaceStatus } from '../shared/api-types';

const EMPTY_WORKSPACE: WorkspaceStatus = {
  ready: true,
  files: [],
  models: [],
  binary: null,
  duplicates: {},
};

describe('App shell', () => {
  let httpTesting: HttpTestingController;
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()],
    });
    httpTesting = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  // The status badge checks health on every render; answer it so verify() passes.
  afterEach(() => {
    httpTesting.match('/api/health').forEach((req) => req.flush({ ok: true }));
    httpTesting.verify();
  });

  async function renderAt(url: string) {
    const fixture = TestBed.createComponent(App);
    await router.navigateByUrl(url);
    // Pages that load data (e.g. Models via httpResource) keep the app unstable until answered.
    const stable = fixture.whenStable();
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve));
      httpTesting.match('/api/models').forEach((req) => req.flush(EMPTY_WORKSPACE));
    }
    await stable;
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
    ['/history', 'Import history', 'Import history | gormcsv Admin'],
    ['/no-such-page', 'Page not found', 'Not found | gormcsv Admin'],
  ])('lazy-loads %s with its heading and document title', async (url, heading, title) => {
    const { el } = await renderAt(url);

    expect(el.querySelector('main h2')?.textContent).toBe(heading);
    expect(TestBed.inject(Title).getTitle()).toBe(title);
  });

  it('follows a nav link click to the section', async () => {
    const { fixture, el } = await renderAt('/import');

    el.querySelector<HTMLAnchorElement>('a[href="/tables"]')?.click();
    await fixture.whenStable();

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
