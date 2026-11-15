import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { ImportResult, RegisterResult } from '../../../shared/api-types';
import { ModelsService, ModelsApiError } from './models.service';

const RESULT: RegisterResult = {
  file: 'TestTypes.csv',
  warnings: [],
  status: { ready: true, files: ['TestTypes.csv'], models: [], binary: null },
};

describe('ModelsService', () => {
  let service: ModelsService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ModelsService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  const csv = () => new File(['a\n1\n'], 'TestTypes.csv', { type: 'text/csv' });

  it('POSTs the file to /api/models and returns the result', async () => {
    const result = firstValueFrom(service.register(csv()));

    const req = httpTesting.expectOne({ method: 'POST', url: '/api/models' });
    expect(((req.request.body as FormData).get('file') as File).name).toBe('TestTypes.csv');
    req.flush(RESULT);

    expect(await result).toEqual(RESULT);
  });

  it('carries the error and build output details', async () => {
    const result = firstValueFrom(service.register(csv()));

    httpTesting
      .expectOne('/api/models')
      .flush(
        { ok: false, error: 'go build failed', details: 'undefined: Bogus' },
        { status: 500, statusText: 'Error' },
      );

    const err = await result.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelsApiError);
    expect(err).toMatchObject({ message: 'go build failed', details: 'undefined: Bogus' });
  });

  it.each([
    [0, 'Server unreachable'],
    [502, 'Request failed (HTTP 502)'],
  ])('describes a status %i without a JSON body', async (status, message) => {
    const result = firstValueFrom(service.register(csv()));

    const req = httpTesting.expectOne('/api/models');
    if (status === 0) req.error(new ProgressEvent('error'));
    else req.flush('bad gateway', { status, statusText: 'Bad Gateway' });

    await expect(result).rejects.toThrow(message);
  });

  it('POSTs an import request as JSON and returns the result', async () => {
    const imported: ImportResult = {
      complete: true,
      files: [{ model: 'TestTypes', inserted: 6, duplicates: 0, rejected: 0 }],
      totals: { inserted: 6, duplicates: 0, rejected: 0 },
      errors: [],
      database: '/ws/gormcsv.db',
    };
    const result = firstValueFrom(
      service.populate({ file: 'TestTypes.csv', batchSize: 100, workers: 1 }),
    );

    const req = httpTesting.expectOne({ method: 'POST', url: '/api/import' });
    expect(req.request.body).toEqual({ file: 'TestTypes.csv', batchSize: 100, workers: 1 });
    req.flush(imported);

    expect(await result).toEqual(imported);
  });

  it('turns an import error into a ModelsApiError', async () => {
    const result = firstValueFrom(service.populate({ batchSize: 100, workers: 1 }));

    httpTesting
      .expectOne('/api/import')
      .flush(
        { ok: false, error: 'No models are built yet; register a CSV first' },
        { status: 503, statusText: 'Unavailable' },
      );

    await expect(result).rejects.toThrow('No models are built yet; register a CSV first');
  });
});
