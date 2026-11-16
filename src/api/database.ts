/**
 * Which database imports write to, read once from the environment when the server starts. The
 * browser never sends or receives a connection string: DSNs carry passwords, and a page that
 * accepted one would let anyone who can reach the admin point gormcsv at any database. The UI
 * only gets a DatabaseInfo with the password redacted.
 *
 * gormcsv passes the DSN straight to its GORM driver, and each driver has its own syntax:
 * - sqlite: a file path, optionally with ?query parameters
 * - postgres: a URL (postgres://user:pass@host/db) or key=value pairs (host=x password=y)
 * - mysql: user:pass@tcp(host:3306)/db?params
 * findPassword locates the password in each form, redactDsn masks just that part, and scrub()
 * hides it anywhere in other text, such as an error message, in case a driver echoes it back.
 */

import type { DatabaseDriver, DatabaseInfo } from '../shared/api-types';

export interface DatabaseConfig {
  driver: DatabaseDriver;
  dsn: string;
}

const DRIVERS: Record<string, DatabaseDriver> = {
  sqlite: 'sqlite',
  postgres: 'postgres',
  postgresql: 'postgres',
  mysql: 'mysql',
};

const MASK = '***';

/**
 * Reads GORMCSV_DB_DRIVER and GORMCSV_DSN. Without them, imports go to SQLite at defaultSqlite.
 * Throws on a bad combination, so a misconfigured server fails at startup, not on first import.
 */
export function databaseFromEnv(
  env: Record<string, string | undefined>,
  defaultSqlite: string,
): DatabaseConfig {
  const rawDriver = env['GORMCSV_DB_DRIVER']?.trim().toLowerCase() || 'sqlite';
  const driver = DRIVERS[rawDriver];
  if (!driver) {
    throw new Error(
      `GORMCSV_DB_DRIVER must be sqlite, postgres or mysql, not ${JSON.stringify(rawDriver)}`,
    );
  }
  const dsn = env['GORMCSV_DSN']?.trim() ?? '';
  if (!dsn && driver !== 'sqlite') {
    throw new Error(`GORMCSV_DSN is required when GORMCSV_DB_DRIVER is ${driver}`);
  }
  return { driver, dsn: dsn || defaultSqlite };
}

interface PasswordSpan {
  /** Where the password sits in the DSN, as written there. */
  index: number;
  length: number;
  /** The password itself, with any URL encoding, quoting or escaping undone. */
  value: string;
}

/** Locates the password in a DSN, or returns null when it has none. */
export function findPassword({ driver, dsn }: DatabaseConfig): PasswordSpan | null {
  // Patterns use the d flag, so match.indices gives the password's exact position.
  const span = (match: RegExpExecArray | null, decode: (raw: string) => string) => {
    const raw = match?.[1];
    const at = match?.indices?.[1];
    if (!raw || !at) return null;
    return { index: at[0], length: raw.length, value: decode(raw) };
  };
  const urlDecode = (raw: string) => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  };
  if (driver === 'postgres' && /^postgres(?:ql)?:\/\//i.test(dsn)) {
    // postgres://user:password@host/db
    const inUrl = span(/^postgres(?:ql)?:\/\/[^:@/]*:([^@/]*)@/di.exec(dsn), urlDecode);
    if (inUrl) return inUrl;
  } else if (driver === 'postgres') {
    // key=value form; a value can be single-quoted, with \' and \\ escapes.
    const pair = span(/(?:^|\s)password\s*=\s*('(?:[^'\\]|\\.)*'|\S*)/di.exec(dsn), (raw) =>
      raw.startsWith("'") ? raw.slice(1, -1).replace(/\\(.)/g, '$1') : raw,
    );
    if (pair) return pair;
  } else if (driver === 'mysql') {
    // user:password@tcp(host:3306)/db; the password runs to the last @ before the address.
    const userInfo = span(/^[^:@/]*:(.*)@(?:\w+\(|\/)/d.exec(dsn), (raw) => raw);
    if (userInfo) return userInfo;
  }
  return span(/[?&](?:password|pass|_auth_pass)=([^&]*)/di.exec(dsn), urlDecode);
}

/** Replaces the DSN's password, wherever it appears in text, with ***. For error messages. */
export function scrub(text: string, config: DatabaseConfig): string {
  const password = findPassword(config)?.value;
  if (!password) return text;
  // Drivers may print the raw or the URL-encoded form.
  return [password, encodeURIComponent(password)].reduce(
    (result, form) => result.replaceAll(form, MASK),
    text,
  );
}

/** The DSN with just its password masked, so the rest stays readable. */
export function redactDsn(config: DatabaseConfig): string {
  const span = findPassword(config);
  if (!span) return config.dsn;
  return config.dsn.slice(0, span.index) + MASK + config.dsn.slice(span.index + span.length);
}

/** The driver and DSN, safe to show. */
export function databaseInfo(config: DatabaseConfig): DatabaseInfo {
  return { driver: config.driver, dsn: redactDsn(config) };
}
