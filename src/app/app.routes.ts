import { Routes } from '@angular/router';

/** Feature pages are lazy-loaded so each section's code is only fetched when first visited. */
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
