/**
 * Server-only providers, merged over the browser appConfig. provideServerRendering with
 * withRoutes(serverRoutes) tells the SSR engine how to render each route (see
 * app.routes.server.ts). Keeping this in a separate file keeps server rendering code out of the
 * browser bundle.
 */

import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';

const serverConfig: ApplicationConfig = {
  providers: [provideServerRendering(withRoutes(serverRoutes))],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
