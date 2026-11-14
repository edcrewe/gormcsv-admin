/**
 * How each route is rendered by the server. Prerender produces static HTML at build time, for pages
 * that need no live data: Import and the placeholder pages. Models uses Client rendering, because
 * it shows live /api data that does not exist at build time. Unknown paths use Server rendering on
 * request, so the not-found page can return a real 404 status.
 */

import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'import', renderMode: RenderMode.Prerender },
  // Shows live workspace data from /api, which does not exist at build time, so render in the browser.
  { path: 'models', renderMode: RenderMode.Client },
  { path: 'tables', renderMode: RenderMode.Prerender },
  { path: 'history', renderMode: RenderMode.Prerender },
  // Unknown paths can't be prerendered, so render the not-found page on request with a real 404.
  { path: '**', renderMode: RenderMode.Server, status: 404 },
];
