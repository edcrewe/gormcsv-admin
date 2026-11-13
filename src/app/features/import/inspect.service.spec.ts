import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { InspectResult } from '../../../shared/api-types';
import { InspectService } from './inspect.service';

const RESULT: InspectResult = {
  file: 'TestTypes.csv',
  models: [{ name: 'TestTypes', key: 'testtypes', fields: [{ name: 'Wordcol', type: 'string' }] }],
  source: 'type TestTypes struct {}',
  warnings: [],
};

describe('InspectService', () => {
  let service: InspectService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(InspectService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  const csv = () => new File(['a,b\n1,2\n'], 'TestTypes.csv', { type: 'text/csv' });

  it('POSTs the file as multipart field "file" and returns the result', async () => {
    const result = firstValueFrom(service.inspect(csv()));

    const req = httpTesting.expectOne({ method: 'POST', url: '/api/inspect' });
    const body = req.request.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect((body.get('file') as File).name).toBe('TestTypes.csv');
    req.flush(RESULT);

    expect(await result).toEqual(RESULT);
  });

  it.each([
    [
      { ok: false, error: 'inspect "x.csv": wrong number of fields' },
      422,
      'inspect "x.csv": wrong number of fields',
    ],
    [{ ok: false, error: 'File is too large' }, 413, 'File is too large'],
    ['<html>proxy error</html>', 502, 'Inspect failed (HTTP 502)'],
  ])(
    'turns a %j %i response into an Error with a readable message',
    async (body, status, message) => {
      const result = firstValueFrom(service.inspect(csv()));

      httpTesting.expectOne('/api/inspect').flush(body, { status, statusText: 'Error' });

      await expect(result).rejects.toThrow(message);
    },
  );

  it('reports a network failure as "Server unreachable"', async () => {
    const result = firstValueFrom(service.inspect(csv()));

    httpTesting.expectOne('/api/inspect').error(new ProgressEvent('error'));

    await expect(result).rejects.toThrow('Server unreachable');
  });
});
