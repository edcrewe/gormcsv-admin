/**
 * POST /api/import: "migrate and populate". It takes a JSON body naming one registered CSV (or
 * none, for all of them) plus batch size and worker count, and runs the workspace gormcsv's
 * importcsv. importcsv creates or alters each table to match its model, then batch-inserts the
 * rows. The body is validated here before anything runs, because these values end up as command
 * arguments. A partial import, where some rows were rejected, is still a 200 with complete: false:
 * the valid rows were committed, and the UI shows which rows failed and why. Imports queue behind
 * registrations in the workspace, so they never run against a half-swapped binary.
 */

import express, { Request, Response, Router } from 'express';
import type { ImportRequest } from '../shared/api-types';
import { errorMessage } from './commands';
import { databaseInfo } from './database';
import { HistoryLog } from './history';
import { sendWorkspaceError } from './models';
import { ModelWorkspace, WorkspaceError } from './workspace';

export interface ImportDeps {
  workspace: ModelWorkspace;
  /** Records each import when provided. */
  history?: HistoryLog;
}

export const BATCH_SIZE_RANGE = { min: 1, max: 100_000 };
export const WORKERS_RANGE = { min: 1, max: 64 };

/** Returns the validated request, or a message saying what is wrong with it. */
export function parseImportRequest(body: unknown): ImportRequest | string {
  if (typeof body !== 'object' || body === null) return 'Send a JSON object';
  const { file, batchSize, workers } = body as Record<string, unknown>;
  if (file !== undefined && (typeof file !== 'string' || file === '')) {
    return 'file must be a registered CSV filename';
  }
  const inRange = (value: unknown, { min, max }: { min: number; max: number }) =>
    Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
  if (!inRange(batchSize, BATCH_SIZE_RANGE)) {
    return `batchSize must be a whole number from ${BATCH_SIZE_RANGE.min} to ${BATCH_SIZE_RANGE.max}`;
  }
  if (!inRange(workers, WORKERS_RANGE)) {
    return `workers must be a whole number from ${WORKERS_RANGE.min} to ${WORKERS_RANGE.max}`;
  }
  return {
    ...(file !== undefined && { file: file as string }),
    batchSize,
    workers,
  } as ImportRequest;
}

export function createImportRouter({ workspace, history }: ImportDeps): Router {
  const router = Router();

  router.post('/', express.json(), async (req: Request, res: Response) => {
    const parsed = parseImportRequest(req.body);
    if (typeof parsed === 'string') {
      res.status(400).json({ ok: false, error: parsed });
      return;
    }
    const file = parsed.file && { file: parsed.file };
    try {
      const result = await workspace.populate(parsed);
      await history?.record({
        action: 'import',
        outcome: result.complete ? 'ok' : 'partial',
        ...file,
        database: result.database,
        totals: result.totals,
        ...(result.errors.length && { errors: result.errors }),
      });
      res.json(result);
    } catch (err: unknown) {
      await history?.record({
        action: 'import',
        outcome: 'failed',
        ...file,
        database: databaseInfo(workspace.database),
        message: errorMessage(err),
      });
      if (err instanceof WorkspaceError) {
        sendWorkspaceError(res, err);
        return;
      }
      res.status(500).json({ ok: false, error: 'Import failed', details: errorMessage(err) });
    }
  });

  return router;
}
