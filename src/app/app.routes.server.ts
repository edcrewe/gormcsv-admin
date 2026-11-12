import { RenderMode, ServerRoute } from '@angular/ssr';

export const serverRoutes: ServerRoute[] = [
  { path: '', renderMode: RenderMode.Prerender },
  { path: 'import', renderMode: RenderMode.Prerender },
  { path: 'models', renderMode: RenderMode.Prerender },
  { path: 'tables', renderMode: RenderMode.Prerender },
  { path: 'history', renderMode: RenderMode.Prerender },
  // Unknown paths can't be prerendered, so render the not-found page on request with a real 404.
  { path: '**', renderMode: RenderMode.Server, status: 404 },
];
