import { authStore } from '../auth/auth-store';
import {
  createInvitation,
  createWorkspace,
  fetchInvitations,
  fetchUserWorkspaces,
} from './workspace-client';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function workspaceListBody() {
  return [
    {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Alice Personal Workspace',
      description: null,
      role: 'OWNER',
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Acme Corp',
      description: 'Company notes',
      role: 'EDITOR',
    },
  ];
}

function invitationBody(overrides: Record<string, unknown> = {}) {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    workspaceId: '33333333-3333-4333-8333-333333333333',
    email: 'new-member@example.com',
    role: 'EDITOR',
    token: 'invite-token',
    expiresAt: '2026-12-31T00:00:00.000Z',
    acceptedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('mobile workspace client (shared contracts)', () => {
  beforeEach(() => {
    authStore.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads and parses the workspace list with the shared schema', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => workspaceListBody(),
    });

    const list = await fetchUserWorkspaces();

    expect(list).toHaveLength(2);
    expect(list[1]).toMatchObject({ name: 'Acme Corp', role: 'EDITOR' });
  });

  it('creates a workspace and the response is validated', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        id: '55555555-5555-4555-8555-555555555555',
        name: 'Research',
        description: null,
        role: 'OWNER',
      }),
    });

    const created = await createWorkspace({
      name: '  Research  ', // trimmed by the shared schema
      description: null,
    });

    expect(created.name).toBe('Research');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/workspaces'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects a too-short workspace name client-side', async () => {
    await expect(createWorkspace({ name: 'ab' })).rejects.toThrow(
      'Workspace name must be at least 3 characters',
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('sends an invitation with a valid email and role', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => invitationBody({ role: 'VIEWER' }),
    });

    const invitation = await createInvitation(
      '33333333-3333-4333-8333-333333333333',
      'new-member@example.com',
      'VIEWER',
    );

    expect(invitation).toMatchObject({ role: 'VIEWER', acceptedAt: null });
    const [, options] = jest.mocked(globalThis.fetch).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(options.body))).toEqual({
      email: 'new-member@example.com',
      role: 'VIEWER',
    });
  });

  it('rejects invalid invitation email and forbids inviting as OWNER client-side', async () => {
    globalThis.fetch = jest.fn();
    await expect(
      createInvitation('ws-id', 'not-an-email', 'EDITOR'),
    ).rejects.toThrow();
    // The shared schema only allows EDITOR / VIEWER for invitations.
    await expect(
      createInvitation('ws-id', 'a@b.com', 'OWNER' as 'EDITOR'),
    ).rejects.toThrow();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('lists invitations including accepted ones', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        invitationBody(),
        invitationBody({
          id: '66666666-6666-4666-8666-666666666666',
          email: 'joined@example.com',
          acceptedAt: '2026-02-01T00:00:00.000Z',
        }),
      ],
    });

    const invitations = await fetchInvitations(
      '33333333-3333-4333-8333-333333333333',
    );

    expect(invitations).toHaveLength(2);
    expect(invitations[1].acceptedAt).not.toBeNull();
  });

  it('refreshes the access token once on 401 and retries (shared auth behavior)', async () => {
    authStore.setTokens('access-1', 'refresh-9', {
      id: USER_ID,
      email: 'a@b.com',
    });
    const refreshSpy = jest
      .spyOn(authStore, 'refreshAccessToken')
      .mockResolvedValue('ok');
    let calls = 0;
    globalThis.fetch = jest.fn().mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        return { ok: false, status: 401, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => workspaceListBody() };
    });

    const list = await fetchUserWorkspaces();

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
    expect(list).toHaveLength(2);
  });
});