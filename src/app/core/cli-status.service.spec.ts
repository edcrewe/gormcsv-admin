import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CliStatusService } from './cli-status.service';

describe('CliStatusService', () => {
  let service: CliStatusService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(CliStatusService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('starts unknown and not ready', () => {
    expect(service.status()).toBeNull();
    expect(service.ready()).toBe(false);
  });

  it('is ready after a successful health check', () => {
    service.check();
    httpTesting.expectOne('/api/health').flush({ ok: true, version: 'v0.3.1-3-g4446d92' });

    expect(service.status()).toEqual({ ok: true, version: 'v0.3.1-3-g4446d92' });
    expect(service.ready()).toBe(true);
  });

  it('uses the server error body for a 503', () => {
    service.check();
    httpTesting
      .expectOne('/api/health')
      .flush(
        { ok: false, error: 'gormcsv CLI not available' },
        { status: 503, statusText: 'Unavailable' },
      );

    expect(service.status()).toEqual({ ok: false, error: 'gormcsv CLI not available' });
    expect(service.ready()).toBe(false);
  });

  it('reports "Server unreachable" when there is no JSON body', () => {
    service.check();
    httpTesting.expectOne('/api/health').error(new ProgressEvent('error'));

    expect(service.status()).toEqual({ ok: false, error: 'Server unreachable' });
  });

  it('replaces the status on a re-check', () => {
    service.check();
    httpTesting.expectOne('/api/health').flush({ ok: true });
    service.check();
    httpTesting
      .expectOne('/api/health')
      .flush({ ok: false, error: 'gone' }, { status: 503, statusText: '' });

    expect(service.ready()).toBe(false);
  });
});
