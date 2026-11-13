import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { NextFunction, Request, RequestHandler, Response } from 'express';
import multer, { MulterError } from 'multer';
import { errorMessage } from './commands';

export interface UploadOptions {
  /** Defaults to 50 MiB. */
  maxUploadBytes?: number;
  /** Parent for per-request temp dirs. Defaults to the OS temp dir. */
  tempRoot?: string;
}

/** A request after csvUpload: the CSV is at file.path, inside its own temp dir. */
export type CsvUploadRequest = Request & { file: Express.Multer.File; uploadDir: string };

const DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
// gormcsv derives the model and factory key from the filename, so keep it to plain, predictable names.
const SAFE_CSV_NAME = /^[\w][\w .-]{0,99}\.csv$/i;

class BadUpload extends Error {}

export function safeCsvName(originalName: string): string | null {
  const name = basename(originalName.replaceAll('\\', '/'));
  return SAFE_CSV_NAME.test(name) ? name : null;
}

/**
 * Accepts one CSV as multipart field "file", written to a per-request temp dir that is removed
 * when the response closes. Rejects bad names (400), oversize files (413) and missing files (400).
 */
export function csvUpload({
  maxUploadBytes = DEFAULT_MAX_UPLOAD_BYTES,
  tempRoot = tmpdir(),
}: UploadOptions = {}): RequestHandler {
  const upload = multer({
    limits: { fileSize: maxUploadBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (safeCsvName(file.originalname)) cb(null, true);
      else cb(new BadUpload('Upload a .csv file with a plain filename'));
    },
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        mkdtemp(join(tempRoot, 'gormcsv-upload-'))
          .then((dir) => {
            (req as Partial<CsvUploadRequest>).uploadDir = dir;
            cb(null, dir);
          })
          .catch((err: unknown) => cb(err as Error, ''));
      },
      filename: (_req, file, cb) => cb(null, safeCsvName(file.originalname) ?? 'upload.csv'),
    }),
  });

  return (req: Request, res: Response, next: NextFunction) => {
    const uploadReq = req as Partial<CsvUploadRequest>;
    // Remove the temp dir however the request ends, including multer rejections mid-upload.
    res.on('close', () => {
      if (uploadReq.uploadDir) void rm(uploadReq.uploadDir, { recursive: true, force: true });
    });
    upload.single('file')(req, res, (err: unknown) => {
      if (err) {
        sendUploadError(res, err);
      } else if (!uploadReq.file || !uploadReq.uploadDir) {
        res
          .status(400)
          .json({ ok: false, error: 'No file uploaded; send a CSV as the "file" field' });
      } else {
        next();
      }
    });
  };
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
