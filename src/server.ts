/**
 * Node entry point, used both by the dev server (ng serve, through reqHandler) and in production
 * (node dist/gormcsv-admin/server/server.mjs). It mounts /api first, then the static browser files,
 * then the Angular SSR engine for every other path, so API requests are never rendered as pages.
 * Settings come from environment variables (PORT, HOST, GORMCSV_BIN, GORMCSV_WORKSPACE,
 * GORMCSV_SRC, GO_BIN). The command runner and ModelWorkspace are created once here and passed into
 * the router, so the whole app shares one workspace and one build queue. It binds to 127.0.0.1 by
 * default, because the API runs local commands and builds.
 */

import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createApiRouter } from './api/api-router';
import { createCommandRunner, createExecRunner } from './api/commands';
import { databaseFromEnv } from './api/database';
import { ModelWorkspace } from './api/workspace';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

/**
 * API routes are mounted before static files and the Angular handler so they are never rendered as pages.
 */
const env = process.env;
const run = createCommandRunner();
const workspaceDir =
  env['GORMCSV_WORKSPACE'] || join(homedir(), '.local', 'share', 'gormcsv-admin');
// Throws on a bad GORMCSV_DB_DRIVER/GORMCSV_DSN, so misconfiguration stops the server at startup.
const database = databaseFromEnv(env, join(workspaceDir, 'gormcsv.db'));
const workspace = new ModelWorkspace({
  dir: workspaceDir,
  srcDir: env['GORMCSV_SRC'] || join(workspaceDir, 'gormcsv-src'),
  run,
  gormcsvBin: env['GORMCSV_BIN'],
  goBin: env['GO_BIN'],
  database,
});
app.use(
  '/api',
  createApiRouter({
    runner: createExecRunner({ binary: env['GORMCSV_BIN'], run }),
    workspace,
    database,
  }),
);

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The admin runs CLI commands against local databases, so it binds to localhost unless HOST overrides it.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = Number(process.env['PORT'] || 4000);
  const host = process.env['HOST'] || '127.0.0.1';
  app.listen(port, host, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://${host}:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
