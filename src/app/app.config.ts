/**
 * App-wide providers for the browser; app.config.server.ts merges them into the server config too.
 * Standalone Angular apps register here what NgModules used to provide: the router with the routes
 * from app.routes.ts, HttpClient (used by the services and by httpResource), hydration of server-
 * rendered HTML, and a global error listener. Services decorated with @Service() register
 * themselves, so they are not listed here.
 */

import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideClientHydration(),
    provideHttpClient(),
  ],
};
