import { createFileRoute } from '@tanstack/react-router';

import { WorkspaceSettings } from '../features/workspaces/workspace-settings';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

function SettingsPage() {
  return <WorkspaceSettings />;
}