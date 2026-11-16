/**
 * Client-side routes. Each feature page uses loadComponent with a dynamic import(), so the bundler
 * puts it in its own chunk, which is only downloaded the first time that route is visited. That
 * keeps the initial bundle small. The title property sets the browser tab title on each navigation,
 * which also tells screen reader users where they are. Unknown paths fall through to the not-found
 * page.
 */

import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'import' },
  {
    path: 'import',
    title: 'Import CSV | gormcsv Admin',
    loadComponent: () => import('./features/import/import-page').then((m) => m.ImportPage),
  },
  {
    path: 'models',
    title: 'Models | gormcsv Admin',
    loadComponent: () => import('./features/models/models-page').then((m) => m.ModelsPage),
  },
  {
    path: 'tables',
    title: 'Tables | gormcsv Admin',
    loadComponent: () => import('./features/tables/tables-page').then((m) => m.TablesPage),
  },
  {
    // The same page with one table selected; its name binds to the page's name input.
    path: 'tables/:name',
    title: 'Tables | gormcsv Admin',
    loadComponent: () => import('./features/tables/tables-page').then((m) => m.TablesPage),
  },
  {
    path: 'history',
    title: 'Import history | gormcsv Admin',
    loadComponent: () => import('./features/history/history-page').then((m) => m.HistoryPage),
  },
  {
    path: '**',
    title: 'Not found | gormcsv Admin',
    loadComponent: () => import('./features/not-found/not-found-page').then((m) => m.NotFoundPage),
  },
];
