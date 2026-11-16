/**
 * API entry point: builds the Express router that server.ts mounts at /api, and wires the health,
 * inspect and models routes to their dependencies. The gormcsv runner, the model workspace and
 * upload limits are passed in rather than imported, so tests can build the same router with fakes
 * and drive it over HTTP with supertest. GET /health runs `gormcsv version`; a binary without that
 * command also lacks ragged-row skipping, so it is reported as unusable. Handlers are async
 * functions, and each catches its own errors to return JSON with a deliberate status code. The
 * final 404 handler stops unknown /api paths from falling through to the Angular page renderer.
 */

import { NextFunction, Request, Response, Router } from 'express';
import type { HealthStatus } from '../shared/api-types';
import { CommandError, GormcsvRunner, errorMessage } from './commands';
import { createImportRouter } from './import-route';
import { InspectDeps, createInspectRouter } from './inspect';
import { DatabaseConfig } from './database';
import { createModelsRouter } from './models';
import { createTablesRouter } from './tables';
import { UploadOptions } from './upload';
import { ModelWorkspace } from './workspace';

export interface ApiDeps {
  runner: GormcsvRunner;
  inspect?: Omit<InspectDeps, 'runner'>;
  /** Enables /api/models and /api/import when provided. */
  workspace?: ModelWorkspace;
  upload?: UploadOptions;
  /** Enables /api/tables when provided. */
  database?: DatabaseConfig;
}

export function createApiRouter({
  runner,
  inspect = {},
  workspace,
  upload = {},
  database,
}: ApiDeps): Router {
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
    router.use('/import', createImportRouter({ workspace }));
  }
  if (database) {
    router.use('/tables', createTablesRouter({ runner, database }));
  }

  // Unknown API paths must not fall through to the Angular renderer.
  router.use((_req, res) => {
    res.status(404).json({ ok: false, error: 'Not found' });
  });

  // Errors thrown by middleware, such as malformed JSON from express.json(), would otherwise get
  // Express's default HTML page with a stack trace. Keep every /api response JSON.
  router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const status = (err as { status?: unknown }).status;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      res.status(status).json({ ok: false, error: 'Bad request', details: errorMessage(err) });
      return;
    }
    res.status(500).json({ ok: false, error: 'Internal error', details: errorMessage(err) });
  });

  return router;
}
