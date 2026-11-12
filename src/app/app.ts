import { Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { CliStatusBadge } from './core/cli-status-badge';

export interface NavItem {
  path: string;
  label: string;
  icon: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { path: '/import', label: 'Import CSV', icon: 'upload_file' },
  { path: '/models', label: 'Models', icon: 'schema' },
  { path: '/tables', label: 'Tables', icon: 'table_view' },
  { path: '/history', label: 'History', icon: 'history' },
];

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatSidenavModule,
    MatToolbarModule,
    CliStatusBadge,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly navItems = NAV_ITEMS;
  protected readonly navOpen = signal(true);

  toggleNav() {
    this.navOpen.update((open) => !open);
  }
}
