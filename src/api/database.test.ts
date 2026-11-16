import {
  DatabaseConfig,
  databaseFromEnv,
  databaseInfo,
  findPassword,
  redactDsn,
  scrub,
} from './database';

describe('databaseFromEnv', () => {
  const DEFAULT = '/ws/gormcsv.db';

  it('defaults to SQLite in the workspace', () => {
    expect(databaseFromEnv({}, DEFAULT)).toEqual({ driver: 'sqlite', dsn: DEFAULT });
  });

  it('accepts a SQLite path', () => {
    expect(databaseFromEnv({ GORMCSV_DSN: '/data/app.db' }, DEFAULT)).toEqual({
      driver: 'sqlite',
      dsn: '/data/app.db',
    });
  });

  it.each([
    ['postgres', 'postgres'],
    [' PostgreSQL ', 'postgres'],
    ['mysql', 'mysql'],
  ])('normalises driver %j to %s', (raw, driver) => {
    expect(databaseFromEnv({ GORMCSV_DB_DRIVER: raw, GORMCSV_DSN: 'x' }, DEFAULT).driver).toBe(
      driver,
    );
  });

  it('rejects an unsupported driver', () => {
    expect(() => databaseFromEnv({ GORMCSV_DB_DRIVER: 'oracle' }, DEFAULT)).toThrow(
      'GORMCSV_DB_DRIVER must be sqlite, postgres or mysql, not "oracle"',
    );
  });

  it.each(['postgres', 'mysql'])('requires a DSN for %s', (driver) => {
    expect(() => databaseFromEnv({ GORMCSV_DB_DRIVER: driver, GORMCSV_DSN: ' ' }, DEFAULT)).toThrow(
      `GORMCSV_DSN is required when GORMCSV_DB_DRIVER is ${driver}`,
    );
  });
});

describe('password redaction', () => {
  const cases: [DatabaseConfig['driver'], string, string, string | null][] = [
    [
      'postgres',
      'postgres://ed:s3cr%40t%20pw@db:5432/admin?sslmode=disable',
      'postgres://ed:***@db:5432/admin?sslmode=disable',
      's3cr@t pw',
    ],
    ['postgres', 'postgresql://ed:pw@db/admin', 'postgresql://ed:***@db/admin', 'pw'],
    ['postgres', 'postgres://ed@db/admin?password=qp', 'postgres://ed@db/admin?password=***', 'qp'],
    ['postgres', 'postgres://ed@db/admin', 'postgres://ed@db/admin', null],
    [
      'postgres',
      'host=db user=ed password=plain dbname=admin',
      'host=db user=ed password=*** dbname=admin',
      'plain',
    ],
    [
      'postgres',
      "host=db password='it\\'s a pw' dbname=admin",
      'host=db password=*** dbname=admin',
      "it's a pw",
    ],
    ['postgres', 'password = spaced host=db', 'password = *** host=db', 'spaced'],
    ['postgres', 'host=db user=ed dbname=admin', 'host=db user=ed dbname=admin', null],
    [
      'mysql',
      'ed:p@ss:w@tcp(db:3306)/admin?parseTime=true',
      'ed:***@tcp(db:3306)/admin?parseTime=true',
      'p@ss:w',
    ],
    ['mysql', 'ed:pw@/admin', 'ed:***@/admin', 'pw'],
    ['mysql', 'ed@tcp(db:3306)/admin', 'ed@tcp(db:3306)/admin', null],
    ['sqlite', '/data/app.db', '/data/app.db', null],
    [
      'sqlite',
      'file:app.db?_auth&_auth_user=a&_auth_pass=zz',
      'file:app.db?_auth&_auth_user=a&_auth_pass=***',
      'zz',
    ],
  ];

  it.each(cases)('%s %j shows as %j', (driver, dsn, redacted, password) => {
    const config = { driver, dsn };

    expect(redactDsn(config)).toBe(redacted);
    expect(findPassword(config)?.value ?? null).toBe(password);
    expect(databaseInfo(config)).toEqual({ driver, dsn: redacted });
  });
});

describe('scrub', () => {
  const config: DatabaseConfig = { driver: 'postgres', dsn: 'postgres://ed:s3cr%40t@db/admin' };

  it('hides the raw and URL-encoded password anywhere in text', () => {
    expect(scrub('auth s3cr@t failed for postgres://ed:s3cr%40t@db', config)).toBe(
      'auth *** failed for postgres://ed:***@db',
    );
  });

  it('leaves text alone when the DSN has no password', () => {
    expect(scrub('anything', { driver: 'sqlite', dsn: '/x.db' })).toBe('anything');
  });
});
