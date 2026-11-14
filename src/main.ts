/**
 * Browser entry point: bootstraps the standalone App component with appConfig. There are no
 * NgModules; the providers in app.config.ts do that job. In production this runs after the server-
 * rendered or prerendered HTML has loaded, and provideClientHydration lets Angular reuse that
 * existing DOM rather than rebuilding the page.
 */

import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
