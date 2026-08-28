import {
  useEffect,
  useState,
} from 'react';
import {
  createRootRoute,
  Outlet,
  useLocation,
  useNavigate,
} from '@tanstack/react-router';

import { useAuth } from '../features/auth/auth-context';
import { CommandPalette } from '../features/command-palette/command-palette';
import { NotesSidebar } from '../features/notes/components/notes-sidebar';
import { Icon } from '../components/icon';
import { SyncConnectivity } from '../sync/sync-connectivity';
import { ConflictNotifications } from '../sync/conflict-notifications';

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] =
    useState(false);
  const [dismissedAuthRequired, setDismissedAuthRequired] = useState(false);

  const isPublicRoute = location.pathname === '/login' || location.pathname === '/register';

  useEffect(() => {
    if (auth.authState === 'unauthenticated' && !isPublicRoute) {
      navigate({ to: '/login' });
    }
  }, [auth.authState, isPublicRoute, navigate]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setIsCommandPaletteOpen(true);
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    setDismissedAuthRequired(false);
  }, [auth.authState]);

  if (isPublicRoute) {
    return (
    <div className="min-h-screen bg-surface text-on-surface safe-top safe-bottom">
        <Outlet />
      </div>
    );
  }

  if (auth.authState === 'unauthenticated') {
    return null;
  }

  const showAuthBanner = auth.authState === 'auth_required' && !dismissedAuthRequired;

  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <SyncConnectivity />
      <ConflictNotifications />

      {showAuthBanner && (
        <div className="flex items-center justify-between gap-3 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <p className="font-medium">
            Authentication required. Sync is paused until you log in again.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate({ to: '/login' })}
              className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-amber-700"
            >
              Log in
            </button>
            <button
              type="button"
              onClick={() => setDismissedAuthRequired(true)}
              className="text-xs text-amber-600 hover:text-amber-800"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="grid min-h-screen grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)]">
        <NotesSidebar className="hidden md:flex" />

        <main className="min-w-0">
          <header className="sticky header-safe z-20 flex items-center justify-between border-b border-outline-variant/30 bg-surface/80 px-4 py-3 backdrop-blur-md md:hidden">
            <button
              type="button"
              onClick={() => setIsDrawerOpen(true)}
              aria-label="Open notes"
              className="flex size-10 items-center justify-center rounded-lg text-on-surface-variant transition hover:bg-surface-high"
            >
              <Icon name="menu" className="text-[22px]" />
            </button>

            <span className="text-sm font-semibold tracking-tight text-on-surface">
              BigMind
            </span>

            <button
              type="button"
              onClick={() => setIsCommandPaletteOpen(true)}
              aria-label="Search notes"
              title="Search (⌘K)"
              className="flex size-10 items-center justify-center rounded-lg text-on-surface-variant transition hover:bg-surface-high"
            >
              <Icon name="search" className="text-[22px]" />
            </button>
          </header>

          <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 md:py-8 lg:px-12">
            <Outlet />
          </div>
        </main>
      </div>

      {isDrawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close notes"
            className="absolute inset-0 bg-slate-950/30"
            onClick={() => setIsDrawerOpen(false)}
          />

          <NotesSidebar
            className="relative h-full w-[min(84vw,320px)] shadow-2xl"
            onNavigate={() => setIsDrawerOpen(false)}
          />
        </div>
      )}

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
      />
    </div>
  );
}
