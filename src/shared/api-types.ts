/**
 * JSON shapes exchanged between the Express API (src/api) and the Angular app (src/app). Both sides
 * import these types, so changing a response shape gives a compile error wherever it is used rather
 * than a surprise at runtime. The file holds types only, plus the isApiError type guard, which
 * narrows an unknown error body to ApiError at runtime. Nothing here pulls server code into the
 * browser bundle, or browser code into the server.
 */

export interface ApiError {
  ok: false;
  error: string;
  details?: string;
}

export interface HealthStatus {
  ok: boolean;
  /** From `gormcsv version`: a tag, or latest tag plus commits since and short hash. */
  version?: string;
  error?: string;
  details?: string;
}

export interface ModelField {
  name: string;
  type: string;
  /** Struct tag without backticks, when the generator emitted one. */
  tag?: string;
  /** CSV heading the field came from; absent for fields gormcsv adds, such as RowHash. */
  column?: string;
}

export interface GoModel {
  /** Go struct name, e.g. OrderItem. */
  name: string;
  /** Factory key importcsv matches against the CSV filename, e.g. order-item. */
  key: string;
  fields: ModelField[];
}

export interface InspectResult {
  /** Sanitised filename the model was generated from. */
  file: string;
  models: GoModel[];
  /** The generated models.go, for preview and copy. */
  source: string;
  /** Non-fatal CLI warnings, e.g. rows skipped for having the wrong number of fields. */
  warnings: string[];
}

/** The workspace gormcsv binary that can import the registered models. */
export interface WorkspaceBinary {
  /**
   * `gormcsv version` of the build. It ends in -dirty when the generated models.go differs from
   * the checkout's own.
   */
  version: string;
  /** ISO timestamp of the last successful build. */
  builtAt: string;
}

export type DatabaseDriver = 'sqlite' | 'postgres' | 'mysql';

/** The database imports write to. dsn has any password replaced by ***. */
export interface DatabaseInfo {
  driver: DatabaseDriver;
  dsn: string;
}

/**
 * What importing does with a row that is already in the table. gormcsv's --key gives the model a
 * unique index over the key columns; --dedupe adds a RowHash of the whole row with a unique index.
 */
export type DuplicateRule =
  { mode: 'allow' } | { mode: 'key'; columns: string[] } | { mode: 'identical' };

export interface WorkspaceStatus {
  /** False when the gormcsv source checkout is missing or unusable; see problem. */
  ready: boolean;
  problem?: string;
  /** Registered CSV filenames, one per model. */
  files: string[];
  /** Models compiled into the workspace binary, from the inspectcsv report it was built with. */
  models: GoModel[];
  /** Duplicate handling per model key; a model without an entry allows duplicates. */
  duplicates: Record<string, DuplicateRule>;
  /** Where imports write to. */
  database: DatabaseInfo;
  /** Null until the first successful build. */
  binary: WorkspaceBinary | null;
}

export interface RegisterResult {
  /** Filename the model was registered from. */
  file: string;
  warnings: string[];
  status: WorkspaceStatus;
}

export interface ImportRequest {
  /** A registered CSV filename; omit to import every registered CSV. */
  file?: string;
  batchSize: number;
  workers: number;
}

export interface ImportFileResult {
  model: string;
  inserted: number;
  duplicates: number;
  rejected: number;
}

export interface ImportResult {
  /** False when importcsv exited with an error; valid rows are still committed. */
  complete: boolean;
  files: ImportFileResult[];
  totals: { inserted: number; duplicates: number; rejected: number };
  /** Row-level and file-level errors, e.g. "Country.csv row 148: ...". */
  errors: string[];
  /** Where the rows went. */
  database: DatabaseInfo;
}

export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'ok' in value &&
    value.ok === false &&
    'error' in value &&
    typeof value.error === 'string'
  );
}
