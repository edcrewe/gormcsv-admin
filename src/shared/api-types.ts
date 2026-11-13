/**
 * JSON shapes exchanged between the Express API (src/api) and the Angular app (src/app).
 * Types only, so it is safe to import from both sides.
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
