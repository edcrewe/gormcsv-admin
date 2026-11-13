import { Request, Response, Router } from 'express';
import { errorMessage } from './commands';
import { CsvUploadRequest, UploadOptions, csvUpload } from './upload';
import { ModelWorkspace, WorkspaceError, WorkspaceErrorKind } from './workspace';

export interface ModelsDeps extends UploadOptions {
  workspace: ModelWorkspace;
}

const STATUS_FOR: Record<WorkspaceErrorKind, number> = {
  'not-ready': 503,
  rejected: 422,
  build: 500,
};

export function createModelsRouter({ workspace, ...uploadOptions }: ModelsDeps): Router {
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
    try {
      res.json(await workspace.register(file.path, file.filename));
    } catch (err: unknown) {
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
