import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { NextFunction, Request, Response, Router } from 'express';
import multer, { MulterError } from 'multer';
import type { InspectResult } from '../shared/api-types';
import { parseGeneratedModels } from './go-model';
import { GormcsvError, GormcsvRunner, errorMessage } from './gormcsv-runner';

export interface InspectDeps {
  runner: GormcsvRunner;
  /** Defaults to 50 MiB. */
  maxUploadBytes?: number;
  /** Parent for per-request temp dirs. Defaults to the OS temp dir. */
  tempRoot?: string;
}

const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
// gormcsv derives the model and factory key from the filename, so keep it to plain, predictable names.
const SAFE_CSV_NAME = /^[\w][\w .-]{0,99}\.csv$/i;

type InspectRequest = Request & { inspectDir?: string };

class BadUpload extends Error {}

export function safeCsvName(originalName: string): string | null {
  const name = basename(originalName.replaceAll('\\', '/'));
  return SAFE_CSV_NAME.test(name) ? name : null;
}

export function createInspectRouter({
  runner,
  maxUploadBytes = DEFAULT_MAX_UPLOAD_BYTES,
  tempRoot = tmpdir(),
}: InspectDeps): Router {
  const router = Router();

  const upload = multer({
    limits: { fileSize: maxUploadBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (safeCsvName(file.originalname)) cb(null, true);
      else cb(new BadUpload('Upload a .csv file with a plain filename'));
    },
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        mkdtemp(join(tempRoot, 'gormcsv-inspect-'))
          .then((dir) => {
            (req as InspectRequest).inspectDir = dir;
            cb(null, dir);
          })
          .catch((err: unknown) => cb(err as Error, ''));
      },
      filename: (_req, file, cb) => cb(null, safeCsvName(file.originalname) ?? 'upload.csv'),
    }),
  });

  router.post('/', (req: InspectRequest, res: Response, next: NextFunction) => {
    // Remove the temp dir however the request ends, including multer rejections mid-upload.
    res.on('close', () => {
      if (req.inspectDir) void rm(req.inspectDir, { recursive: true, force: true });
    });
    upload.single('file')(req, res, (err: unknown) => (err ? sendUploadError(res, err) : next()));
  });

  router.post('/', async (req: InspectRequest, res: Response) => {
    const file = req.file;
    if (!file || !req.inspectDir) {
      res
        .status(400)
        .json({ ok: false, error: 'No file uploaded; send a CSV as the "file" field' });
      return;
    }
    const output = join(req.inspectDir, 'models.go');
    try {
      await runner(['inspectcsv', '--files', file.path, '--output', output]);
      const source = await readFile(output, 'utf8');
      const result: InspectResult = {
        file: file.filename,
        models: parseGeneratedModels(source),
        source,
      };
      res.json(result);
    } catch (err: unknown) {
      if (err instanceof GormcsvError && !err.timedOut && err.exitCode !== null) {
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

function sendUploadError(res: Response, err: unknown): void {
  if (err instanceof MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ ok: false, error: 'File is too large' });
  } else if (err instanceof MulterError || err instanceof BadUpload) {
    res.status(400).json({ ok: false, error: err.message });
  } else {
    res.status(500).json({ ok: false, error: 'Upload failed', details: errorMessage(err) });
  }
}
