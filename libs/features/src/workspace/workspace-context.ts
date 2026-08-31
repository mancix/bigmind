/**
 * Workspace-scoping provider for shared repositories.
 *
 * Reminders, notifications (and future workspace-cached entities) carry a
 * `workspaceId` so that data from different workspaces never mixes. The shared
 * repositories do NOT know where the "current workspace" lives — the platform
 * injects a {@link WorkspaceContext}:
 *
 * - Web: `apps/web/.../workspace-context.ts` reads `localStorage`
 *   (`bigmind_workspace_id`).
 * - Mobile: `apps/mobile/.../repositories.ts` reads the in-memory cache
 *   hydrated from AsyncStorage.
 * - Tests: the default context returns `null` ("no workspace selected"),
 *   matching the legacy web behavior of falling back to `''`.
 *
 * Future multi-workspace caching (multiple workspaces open at once) and the
 * desktop app can swap this provider without touching repository code.
 */
export interface WorkspaceContext {
  /** The currently selected workspace id, or `null` when none is selected. */
  getWorkspaceId(): string | null;
}

/** Fixed workspace context (used by tests and single-workspace embedders). */
export class StaticWorkspaceContext implements WorkspaceContext {
  constructor(private readonly workspaceId: string | null) {}

  getWorkspaceId(): string | null {
    return this.workspaceId;
  }
}

/** Default context: no workspace selected. */
export const nullWorkspaceContext: WorkspaceContext = {
  getWorkspaceId: () => null,
};

/** Resolve the workspace key used for `where('workspaceId')` queries. */
export function resolveWorkspaceId(
  workspace: WorkspaceContext,
): string {
  return workspace.getWorkspaceId() ?? '';
}