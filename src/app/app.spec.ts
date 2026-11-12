import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { App } from './app';

describe('App', () => {
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  async function render() {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    return fixture;
  }

  it('renders the title', async () => {
    const fixture = await render();
    httpTesting.expectOne('/api/health');

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('gormcsv Admin');
  });

  it('shows the CLI summary when the health check passes', async () => {
    const fixture = await render();

    httpTesting.expectOne('/api/health').flush({ ok: true, summary: 'Generate GORM models' });
    await fixture.whenStable();

    const badge = (fixture.nativeElement as HTMLElement).querySelector('[role="status"]');
    expect(badge?.classList).toContain('ok');
    expect(badge?.textContent).toContain('Generate GORM models');
  });

  it('shows the server error body when the CLI is unavailable', async () => {
    const fixture = await render();

    httpTesting
      .expectOne('/api/health')
      .flush(
        { ok: false, error: 'gormcsv CLI not available' },
        { status: 503, statusText: 'Unavailable' },
      );
    await fixture.whenStable();

    const badge = (fixture.nativeElement as HTMLElement).querySelector('[role="status"]');
    expect(badge?.classList).toContain('error');
    expect(badge?.textContent).toContain('gormcsv CLI not available');
  });

  it('falls back to "Server unreachable" when there is no JSON body', async () => {
    const fixture = await render();

    httpTesting.expectOne('/api/health').error(new ProgressEvent('error'));
    await fixture.whenStable();

    const badge = (fixture.nativeElement as HTMLElement).querySelector('[role="status"]');
    expect(badge?.textContent).toContain('Server unreachable');
  });
});
