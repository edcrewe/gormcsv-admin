import { Router } from 'express';
import type { HealthStatus } from '../shared/api-types';
import { GormcsvError, GormcsvRunner, errorMessage } from './gormcsv-runner';
import { InspectDeps, createInspectRouter } from './inspect';

export interface ApiDeps {
  runner: GormcsvRunner;
  inspect?: Omit<InspectDeps, 'runner'>;
}

export function createApiRouter({ runner, inspect = {} }: ApiDeps): Router {
  const router = Router();

  // `gormcsv version` prints e.g. "gormcsv v0.3.1-3-g4446d92". Older binaries without the command
  // also lack ragged-row skipping, so they are reported as unusable rather than ready.
  router.get('/health', async (_req, res) => {
    try {
      const { stdout } = await runner(['version']);
      const body: HealthStatus = { ok: true, version: stdout.trim().replace(/^gormcsv\s+/, '') };
      res.json(body);
    } catch (err: unknown) {
      const body: HealthStatus = {
        ok: false,
        error: 'gormcsv CLI not available or too old',
        details: err instanceof GormcsvError ? err.cliMessage : errorMessage(err),
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
