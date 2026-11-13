import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CliStatusBadge } from './cli-status-badge';
import { expectNoAxeViolations } from '../../testing/axe';

describe('CliStatusBadge', () => {
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [CliStatusBadge],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  async function render() {
    const fixture = TestBed.createComponent(CliStatusBadge);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, el, status: () => el.querySelector('[role="status"]') };
  }

  it('checks health after render and shows a pending state until it answers', async () => {
    const { status } = await render();

    httpTesting.expectOne('/api/health');
    expect(status()?.textContent).toContain('Checking CLI');
  });

  it('shows ready with the gormcsv version', async () => {
    const { fixture, status } = await render();

    httpTesting.expectOne('/api/health').flush({ ok: true, version: 'v0.3.1-3-g4446d92' });
    await fixture.whenStable();

    const badge = status()?.querySelector('.badge');
    expect(badge?.classList).toContain('ok');
    expect(badge?.textContent).toContain('gormcsv v0.3.1-3-g4446d92');
  });

  it('shows the error with its details as a tooltip when the CLI is unusable', async () => {
    const { fixture, status } = await render();

    httpTesting.expectOne('/api/health').flush(
      {
        ok: false,
        error: 'gormcsv CLI not available or too old',
        details: 'unknown command "version" for "gormcsv"',
      },
      { status: 503, statusText: '' },
    );
    await fixture.whenStable();

    const badge = status()?.querySelector('.badge');
    expect(badge?.classList).toContain('error');
    expect(badge?.textContent).toContain('gormcsv CLI not available or too old');
    expect(badge?.getAttribute('title')).toBe('unknown command "version" for "gormcsv"');
  });

  it('is a polite live region with decorative icons hidden, and passes AXE', async () => {
    const { fixture, el, status } = await render();
    httpTesting.expectOne('/api/health').flush({ ok: true });
    await fixture.whenStable();

    expect(status()?.getAttribute('aria-live')).toBe('polite');
    expect(el.querySelector('mat-icon')?.getAttribute('aria-hidden')).toBe('true');
    await expectNoAxeViolations(el);
  });
});
