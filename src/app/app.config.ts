/**
 * App-wide providers for the browser; app.config.server.ts merges them into the server config too.
 * Standalone Angular apps register here what NgModules used to provide: the router with the routes
 * from app.routes.ts, HttpClient (used by the services and by httpResource), hydration of server-
 * rendered HTML, and a global error listener. Services decorated with @Service() register
 * themselves, so they are not listed here.
 */

import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';

/** The app's router, exported so the shell tests run it exactly as configured here. */
// Route parameters such as /tables/:name arrive as component inputs.
export const routerProviders = provideRouter(routes, withComponentInputBinding());

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    routerProviders,
    provideClientHydration(),
    provideHttpClient(),
  ],
};
