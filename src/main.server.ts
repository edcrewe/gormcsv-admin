/**
 * Server-side entry point, used by the Angular SSR engine in server.ts and at build time for
 * prerendering. It bootstraps the same App with the server config, which adds server rendering and
 * the per-route render modes. The BootstrapContext gives each request its own application instance,
 * so server renders never share state between users.
 */

import { BootstrapContext, bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { config } from './app/app.config.server';

const bootstrap = (context: BootstrapContext) => bootstrapApplication(App, config, context);

export default bootstrap;
