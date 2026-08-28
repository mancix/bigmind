import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';

import { AuthProvider } from './features/auth/auth-context';
import { WorkspaceProvider } from './features/workspaces/workspace-context';
import { PwaStatus } from './app/pwa-status';
import { routeTree } from './routeTree.gen';

import './styles.css';

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Elemento #root non trovato');
}

createRoot(rootElement).render(
  <StrictMode>
    <AuthProvider>
      <WorkspaceProvider>
        <PwaStatus />
        <RouterProvider router={router} />
      </WorkspaceProvider>
    </AuthProvider>
  </StrictMode>,
);
