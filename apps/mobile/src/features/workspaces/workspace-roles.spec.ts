import {
  canEditContent,
  canManageWorkspace,
  canViewMembers,
  workspaceType,
} from './workspace-roles';
import type { WorkspaceInfo } from './workspace-client';

function ws(name: string, role: WorkspaceInfo['role']): WorkspaceInfo {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name,
    description: null,
    role,
  };
}

describe('workspace roles & permissions', () => {
  it('detects personal vs shared workspaces with the backend rule', () => {
    expect(
      workspaceType(ws('Alice Personal Workspace', 'OWNER')),
    ).toBe('personal');
    expect(
      workspaceType(ws('alice personal workspace', 'OWNER')),
    ).toBe('personal');
    expect(workspaceType(ws('Acme Corp', 'EDITOR'))).toBe('shared');
  });

  it('allows only OWNERs to manage the workspace (invite/roles/remove/delete)', () => {
    expect(canManageWorkspace('OWNER')).toBe(true);
    expect(canManageWorkspace('EDITOR')).toBe(false);
    expect(canManageWorkspace('VIEWER')).toBe(false);
  });

  it('allows OWNER and EDITOR to edit content; VIEWER is read-only', () => {
    expect(canEditContent('OWNER')).toBe(true);
    expect(canEditContent('EDITOR')).toBe(true);
    expect(canEditContent('VIEWER')).toBe(false);
  });

  it('allows every role to view members', () => {
    expect(canViewMembers('OWNER')).toBe(true);
    expect(canViewMembers('EDITOR')).toBe(true);
    expect(canViewMembers('VIEWER')).toBe(true);
  });
});