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
