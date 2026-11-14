/**
 * POST /api/inspect: shows the GORM model gormcsv would generate for an uploaded CSV, without
 * storing or changing anything. This is step 1 of the import flow. The csvUpload middleware has
 * already written the file to a per-request temp dir. This handler runs `inspectcsv` on it with its
 * output in the same dir, reads back models.go, parses it, and returns the models, the source and
 * any warnings. gormcsv prints non-fatal problems, such as skipped ragged rows, as "warning:" lines
 * on stderr. Temp paths are replaced by the filename in messages, since they mean nothing to the
 * user. The temp dir is removed when the response closes.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Request, Response, Router } from 'express';
import type { InspectResult } from '../shared/api-types';
import { CommandError, GormcsvRunner, errorMessage } from './commands';
import { parseGeneratedModels } from './go-model';
import { CsvUploadRequest, UploadOptions, csvUpload } from './upload';

export interface InspectDeps extends UploadOptions {
  runner: GormcsvRunner;
}

export function createInspectRouter({ runner, ...uploadOptions }: InspectDeps): Router {
  const router = Router();

  router.post('/', csvUpload(uploadOptions), async (req: Request, res: Response) => {
    const { file, uploadDir } = req as CsvUploadRequest;
    const output = join(uploadDir, 'models.go');
    try {
      const { stderr } = await runner(['inspectcsv', '--files', file.path, '--output', output]);
      const source = await readFile(output, 'utf8');
      const result: InspectResult = {
        file: file.filename,
        models: parseGeneratedModels(source),
        source,
        warnings: cliWarnings(stderr).map((w) => w.replaceAll(file.path, file.filename)),
      };
      res.json(result);
    } catch (err: unknown) {
      if (err instanceof CommandError && !err.timedOut && err.exitCode !== null) {
        // The CLI rejected the CSV; hide the temp path, which means nothing to the user.
        const message = err.cliMessage.replaceAll(file.path, file.filename);
        res.status(422).json({ ok: false, error: message });
        return;
      }
      res.status(500).json({ ok: false, error: 'Inspect failed', details: errorMessage(err) });
    }
  });

  return router;
}

/** gormcsv reports non-fatal problems, such as skipped ragged rows, as "warning: ..." lines on stderr. */
export function cliWarnings(stderr: string): string[] {
  return stderr
    .split('\n')
    .filter((line) => line.startsWith('warning: '))
    .map((line) => line.slice('warning: '.length).trim());
}
