/**
 * /api/models is the HTTP side of the model workspace. GET returns what the workspace gormcsv can
 * import. POST registers an uploaded CSV as a model, which regenerates models.go and rebuilds
 * gormcsv (workspace.ts explains why). A cold build can take minutes, so the POST simply stays open
 * until the workspace's promise settles, while the Angular client shows a progress bar.
 * WorkspaceError kinds map to status codes: 503 when the gormcsv checkout is missing, 422 when
 * gormcsv rejects the CSV, and 500 with the build output when go build fails.
 */

import { Request, Response, Router } from 'express';
import type { DuplicateRule } from '../shared/api-types';
import { errorMessage } from './commands';
import { CsvUploadRequest, UploadOptions, csvUpload } from './upload';
import { HistoryLog } from './history';
import { ModelWorkspace, WorkspaceError, WorkspaceErrorKind, modelKey } from './workspace';

export interface ModelsDeps extends UploadOptions {
  workspace: ModelWorkspace;
  /** Records each registration when provided. */
  history?: HistoryLog;
}

/** HTTP status for each WorkspaceError kind; also used by the import route. */
export const STATUS_FOR: Record<WorkspaceErrorKind, number> = {
  'not-ready': 503,
  'not-found': 404,
  rejected: 422,
  build: 500,
  failed: 500,
};

export function sendWorkspaceError(res: Response, err: WorkspaceError): void {
  const body = { ok: false, error: err.message, ...(err.details && { details: err.details }) };
  res.status(STATUS_FOR[err.kind]).json(body);
}

export function createModelsRouter({ workspace, history, ...uploadOptions }: ModelsDeps): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    try {
      res.json(await workspace.status());
    } catch (err: unknown) {
      res
        .status(500)
        .json({ ok: false, error: 'Reading the workspace failed', details: errorMessage(err) });
    }
  });

  // Registers the uploaded CSV as a model and rebuilds the workspace gormcsv. A cold build can
  // take minutes, so the request stays open until it finishes.
  router.post('/', csvUpload(uploadOptions), async (req: Request, res: Response) => {
    const { file } = req as CsvUploadRequest;
    const duplicates = parseDuplicateRule(req.body);
    if (typeof duplicates === 'string') {
      res.status(400).json({ ok: false, error: duplicates });
      return;
    }
    try {
      const result = await workspace.register(file.path, file.filename, duplicates);
      await history?.record({
        action: 'register',
        outcome: 'ok',
        file: file.filename,
        message: `Duplicates: ${ruleSummary(result.status.duplicates[modelKey(file.filename)])}`,
        ...(result.warnings.length && { errors: result.warnings }),
      });
      res.json(result);
    } catch (err: unknown) {
      await history?.record({
        action: 'register',
        outcome: 'failed',
        file: file.filename,
        message: errorMessage(err),
      });
      if (err instanceof WorkspaceError) {
        const body = {
          ok: false,
          error: err.message,
          ...(err.details && { details: err.details }),
        };
        res.status(STATUS_FOR[err.kind]).json(body);
        return;
      }
      res.status(500).json({ ok: false, error: 'Registering failed', details: errorMessage(err) });
    }
  });

  return router;
}

/**
 * Reads the optional duplicate rule sent with a registration as form fields: duplicates (allow,
 * key or identical) and, for key, one or more keyColumn fields naming CSV headings. Returns
 * undefined to keep the model's current rule, or a message saying what is wrong.
 */
export function parseDuplicateRule(body: unknown): DuplicateRule | undefined | string {
  const fields = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const mode = fields['duplicates'];
  if (mode === undefined) return undefined;
  if (mode === 'allow' || mode === 'identical') return { mode };
  if (mode !== 'key') return 'duplicates must be allow, key or identical';
  const raw = fields['keyColumn'];
  const columns = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).map(String);
  if (columns.length === 0 || columns.some((c) => c.trim() === '')) {
    return 'Choose at least one key column';
  }
  // gormcsv's --key joins columns with +, so a heading containing + cannot be a key.
  if (columns.some((c) => c.includes('+'))) return 'Key columns cannot contain +';
  return { mode: 'key', columns };
}

/** A duplicate rule in a few words, for the history log. */
export function ruleSummary(rule: DuplicateRule | undefined): string {
  if (!rule || rule.mode === 'allow') return 'imported again';
  if (rule.mode === 'identical') return 'identical rows skipped';
  return `key on ${rule.columns.join(' + ')}`;
}
