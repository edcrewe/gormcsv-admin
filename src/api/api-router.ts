import { Router } from 'express';
import type { HealthStatus } from '../shared/api-types';
import { GormcsvRunner, errorMessage } from './gormcsv-runner';
import { InspectDeps, createInspectRouter } from './inspect';

export interface ApiDeps {
  runner: GormcsvRunner;
  inspect?: Omit<InspectDeps, 'runner'>;
}

export function createApiRouter({ runner, inspect = {} }: ApiDeps): Router {
  const router = Router();

  // gormcsv has no --version flag, so --help proves the binary runs and its first line identifies it.
  router.get('/health', async (_req, res) => {
    try {
      const { stdout } = await runner(['--help']);
      const body: HealthStatus = { ok: true, summary: stdout.trim().split('\n')[0] };
      res.json(body);
    } catch (err: unknown) {
      const body: HealthStatus = {
        ok: false,
        error: 'gormcsv CLI not available',
        details: errorMessage(err),
      };
      res.status(503).json(body);
    }
  });

  router.use('/inspect', createInspectRouter({ runner, ...inspect }));

  // Unknown API paths must not fall through to the Angular renderer.
  router.use((_req, res) => {
    res.status(404).json({ ok: false, error: 'Not found' });
  });

  return router;
}
