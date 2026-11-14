/**
 * API entry point: builds the Express router that server.ts mounts at /api, and wires the health,
 * inspect and models routes to their dependencies. The gormcsv runner, the model workspace and
 * upload limits are passed in rather than imported, so tests can build the same router with fakes
 * and drive it over HTTP with supertest. GET /health runs `gormcsv version`; a binary without that
 * command also lacks ragged-row skipping, so it is reported as unusable. Handlers are async
 * functions, and each catches its own errors to return JSON with a deliberate status code. The
 * final 404 handler stops unknown /api paths from falling through to the Angular page renderer.
 */

import { Router } from 'express';
import type { HealthStatus } from '../shared/api-types';
import { CommandError, GormcsvRunner, errorMessage } from './commands';
import { InspectDeps, createInspectRouter } from './inspect';
import { createModelsRouter } from './models';
import { UploadOptions } from './upload';
import { ModelWorkspace } from './workspace';

export interface ApiDeps {
  runner: GormcsvRunner;
  inspect?: Omit<InspectDeps, 'runner'>;
  /** Enables /api/models when provided. */
  workspace?: ModelWorkspace;
  upload?: UploadOptions;
}

export function createApiRouter({ runner, inspect = {}, workspace, upload = {} }: ApiDeps): Router {
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
        details: err instanceof CommandError ? err.cliMessage : errorMessage(err),
      };
      res.status(503).json(body);
    }
  });

  router.use('/inspect', createInspectRouter({ runner, ...upload, ...inspect }));
  if (workspace) {
    router.use('/models', createModelsRouter({ workspace, ...upload }));
  }

  // Unknown API paths must not fall through to the Angular renderer.
  router.use((_req, res) => {
    res.status(404).json({ ok: false, error: 'Not found' });
  });

  return router;
}
