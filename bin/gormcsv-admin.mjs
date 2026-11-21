#!/usr/bin/env node
// Starts the built gormcsv-admin server: `gormcsv-admin [--port 4000] [--host 127.0.0.1]`.
// The server only listens when it is the main module, so it runs as a child process here, with
// this process's stdio, and signals are passed on so Ctrl+C stops it. Everything else, such as
// GORMCSV_DSN, is configured with the environment variables in the README.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = join(root, 'dist', 'gormcsv-admin', 'server', 'server.mjs');

const usage = `Usage: gormcsv-admin [--port <port>] [--host <host>]

Starts the gormcsv admin UI on http://127.0.0.1:4000 by default.
Configure gormcsv and the database with the environment variables in README.md,
for example GORMCSV_DB_DRIVER and GORMCSV_DSN.`;

let options;
try {
  ({ values: options } = parseArgs({
    options: {
      port: { type: 'string', short: 'p' },
      host: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  }));
} catch (err) {
  console.error(`${err.message}\n\n${usage}`);
  process.exit(2);
}
if (options.help) {
  console.log(usage);
  process.exit(0);
}
if (options.port !== undefined && !/^\d+$/.test(options.port)) {
  console.error(`--port must be a number, not ${JSON.stringify(options.port)}`);
  process.exit(2);
}
if (!existsSync(server)) {
  console.error(`No built server at ${server}.\nRun \`npm run build\` in ${root} first.`);
  process.exit(1);
}

const env = { ...process.env };
if (options.port) env.PORT = options.port;
if (options.host) env.HOST = options.host;

const child = spawn(process.execPath, [server], { stdio: 'inherit', env });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
const SIGNAL_EXIT = { SIGINT: 130, SIGTERM: 143 };
child.on('exit', (code, signal) => process.exit(code ?? SIGNAL_EXIT[signal] ?? 1));
