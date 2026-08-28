import { useCallback, useEffect, useState } from 'react';

import { useWorkspaces } from '../workspaces/workspace-context';
import {
  createInvitation,
  fetchInvitations,
  revokeInvitation,
  type InvitationInfo,
  fetchMembers,
  changeMemberRole,
  removeMember,
  type MemberInfo,
} from '../workspaces/workspace-client';

export function WorkspaceSettings() {
  const { currentWorkspace, renameWorkspace, deleteWorkspace } = useWorkspaces();
  const [activeTab, setActiveTab] = useState<'members' | 'invitations' | 'about'>('members');
  const [invitations, setInvitations] = useState<InvitationInfo[]>([]);
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'EDITOR' | 'VIEWER'>('EDITOR');
  const [submitting, setSubmitting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmAction, setConfirmAction] = useState<
    | { type: 'remove'; member: MemberInfo }
    | { type: 'demote'; member: MemberInfo }
    | null
  >(null);

  const loadData = useCallback(async () => {
    if (!currentWorkspace) return;
    setIsLoading(true);
    setError('');
    try {
      const [invList, memberList] = await Promise.all([
        fetchInvitations(currentWorkspace.id).catch(() => []),
        fetchMembers(currentWorkspace.id).catch(() => []),
      ]);
      setInvitations(invList);
      setMembers(memberList);
    } catch {
      setError('Failed to load workspace data');
    } finally {
      setIsLoading(false);
    }
  }, [currentWorkspace]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    if (!currentWorkspace) return;
    setSubmitting(true);
    setError('');
    try {
      await createInvitation(currentWorkspace.id, email, role);
      setEmail('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invitation');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(invitationId: string) {
    if (!currentWorkspace) return;
    try {
      await revokeInvitation(currentWorkspace.id, invitationId);
      await loadData();
    } catch {
      setError('Failed to revoke invitation');
    }
  }

  async function handleRoleChange(member: MemberInfo, newRole: 'OWNER' | 'EDITOR' | 'VIEWER') {
    if (!currentWorkspace || member.role === newRole) return;
    if (member.role === 'OWNER' && newRole !== 'OWNER') {
      setConfirmAction({ type: 'demote', member });
      return;
    }
    await doRoleChange(member, newRole);
  }

  async function doRoleChange(member: MemberInfo, newRole: 'OWNER' | 'EDITOR' | 'VIEWER') {
    if (!currentWorkspace) return;
    setError('');
    try {
      await changeMemberRole(currentWorkspace.id, member.userId, newRole);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change role');
    }
  }

  async function doRemoveMember() {
    if (!currentWorkspace || !confirmAction) return;
    setError('');
    try {
      await removeMember(currentWorkspace.id, confirmAction.member.userId);
      setConfirmAction(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
      setConfirmAction(null);
    }
  }

  if (!currentWorkspace) {
    return <div className="p-4 text-slate-500">Loading...</div>;
  }

  const isOwner = currentWorkspace.role === 'OWNER';
  const pendingInvitations = invitations.filter((inv) => !inv.acceptedAt);
  const acceptedInvitations = invitations.filter((inv) => inv.acceptedAt);

  return (
    <section className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-bold tracking-tight">Workspace Settings</h1>
      <p className="mt-1 text-sm text-slate-500">
        {currentWorkspace.name} — you are {currentWorkspace.role}
      </p>

      <div className="mt-6 flex gap-1 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveTab('members')}
          className={`px-4 py-2 text-sm font-medium transition ${
            activeTab === 'members'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Members
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('invitations')}
          className={`px-4 py-2 text-sm font-medium transition ${
            activeTab === 'invitations'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Invitations
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('about')}
          className={`px-4 py-2 text-sm font-medium transition ${
            activeTab === 'about'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          About
        </button>
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {activeTab === 'members' && (
        <div className="mt-6 space-y-4">
          {isLoading ? (
            <p className="text-sm text-slate-400">Loading members...</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-slate-500">No members found</p>
          ) : (
            <ul className="space-y-2">
              {members.map((member) => (
                <li
                  key={member.userId}
                  className="flex flex-col gap-2 rounded-lg border border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800">{member.email}</p>
                    <p className="text-xs text-slate-400">
                      Joined: {new Date(member.joinedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isOwner ? (
                      <>
                        <select
                          value={member.role}
                          onChange={(e) =>
                            handleRoleChange(
                              member,
                              e.target.value as 'OWNER' | 'EDITOR' | 'VIEWER',
                            )
                          }
                          className="rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-blue-500"
                        >
                          <option value="OWNER">Owner</option>
                          <option value="EDITOR">Editor</option>
                          <option value="VIEWER">Viewer</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => setConfirmAction({ type: 'remove', member })}
                          className="text-xs text-red-500 hover:text-red-700"
                        >
                          Remove
                        </button>
                      </>
                    ) : (
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                        style={{
                          backgroundColor:
                            member.role === 'OWNER'
                              ? 'rgb(219 234 254)'
                              : member.role === 'EDITOR'
                                ? 'rgb(220 252 231)'
                                : 'rgb(243 244 246)',
                          color:
                            member.role === 'OWNER'
                              ? 'rgb(30 64 175)'
                              : member.role === 'EDITOR'
                                ? 'rgb(22 101 52)'
                                : 'rgb(107 114 128)',
                        }}
                      >
                        {member.role}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {!isOwner && (
            <p className="text-xs text-slate-400">Only workspace owners can change roles or remove members.</p>
          )}
        </div>
      )}

      {activeTab === 'invitations' && (
        <div className="mt-6 space-y-6">
          {isOwner && (
            <div className="rounded-lg border border-slate-200 p-4">
              <h2 className="text-lg font-semibold">Invite a user</h2>
              <form onSubmit={handleInvite} className="mt-3 flex flex-wrap gap-3">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'EDITOR' | 'VIEWER')}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
                >
                  <option value="EDITOR">Editor</option>
                  <option value="VIEWER">Viewer</option>
                </select>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting ? 'Sending...' : 'Send invite'}
                </button>
              </form>
            </div>
          )}

          <div>
            <h2 className="mb-3 text-lg font-semibold">Pending invitations</h2>
            {isLoading ? (
              <p className="text-sm text-slate-400">Loading...</p>
            ) : pendingInvitations.length === 0 ? (
              <p className="text-sm text-slate-500">No pending invitations</p>
            ) : (
              <ul className="space-y-2">
                {pendingInvitations.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-800">{inv.email}</p>
                      <p className="text-xs text-slate-400">
                        Role: {inv.role} · Expires: {new Date(inv.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                    {isOwner && (
                      <button
                        type="button"
                        onClick={() => handleRevoke(inv.id)}
                        className="text-sm text-red-500 hover:text-red-700"
                      >
                        Revoke
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h2 className="mb-3 text-lg font-semibold">Accepted invitations</h2>
            {acceptedInvitations.length === 0 ? (
              <p className="text-sm text-slate-500">No accepted invitations yet</p>
            ) : (
              <ul className="space-y-2">
                {acceptedInvitations.map((inv) => (
                  <li
                    key={inv.id}
                    className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-800">{inv.email}</p>
                      <p className="text-xs text-slate-400">
                        Role: {inv.role} · Accepted: {new Date(inv.acceptedAt!).toLocaleDateString()}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {activeTab === 'about' && (
        <div className="mt-6 space-y-4">
          <div className="rounded-lg border border-slate-200 p-4">
            {isOwner ? (
              <RenameForm
                currentName={currentWorkspace.name}
                onRename={async (name) => {
                  await renameWorkspace(currentWorkspace.id, name);
                }}
              />
            ) : (
              <>
                <h2 className="text-lg font-semibold">{currentWorkspace.name}</h2>
                {currentWorkspace.description && (
                  <p className="mt-1 text-sm text-slate-500">{currentWorkspace.description}</p>
                )}
              </>
            )}
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <dt className="text-slate-400">Your role</dt>
              <dd className="font-medium">{currentWorkspace.role}</dd>
            </dl>
            {isOwner && (
              <div className="mt-6 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setDeleteConfirm(true)}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700"
                >
                  Delete Workspace
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-red-700">Delete Workspace</h3>
            <p className="mt-2 text-sm text-slate-500">
              This action permanently deletes <strong>{currentWorkspace.name}</strong> and all its data. This cannot be undone.
            </p>
            <p className="mt-2 text-sm text-slate-500">
              Type <strong>DELETE</strong> to confirm.
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="Type DELETE"
              autoFocus
              className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-500"
            />
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => { setDeleteConfirm(false); setDeleteConfirmText(''); }}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteConfirmText !== 'DELETE' || isDeleting}
                onClick={async () => {
                  setIsDeleting(true);
                  try {
                    await deleteWorkspace(currentWorkspace.id);
                    setDeleteConfirm(false);
                    setDeleteConfirmText('');
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Failed to delete workspace');
                    setIsDeleting(false);
                  }
                }}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {isDeleting ? 'Deleting...' : 'Delete Workspace'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30">
          <div className="rounded-xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-semibold">
              {confirmAction.type === 'remove' ? 'Remove member' : 'Demote owner'}
            </h3>
            <p className="mt-2 text-sm text-slate-500">
              {confirmAction.type === 'remove'
                ? `Are you sure you want to remove ${confirmAction.member.email} from this workspace?`
                : `Are you sure you want to demote ${confirmAction.member.email} from Owner to Editor? This workspace must have at least one Owner.`}
            </p>
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirmAction.type === 'remove') {
                    void doRemoveMember();
                  } else if (confirmAction.type === 'demote') {
                    void doRoleChange(confirmAction.member, 'EDITOR');
                    setConfirmAction(null);
                  }
                }}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700"
              >
                {confirmAction.type === 'remove' ? 'Remove' : 'Demote'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function RenameForm({
  currentName,
  onRename,
}: {
  currentName: string;
  onRename: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(currentName);
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!isEditing) {
    return (
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{currentName}</h2>
        <button
          type="button"
          onClick={() => { setName(currentName); setIsEditing(true); }}
          className="rounded-lg px-3 py-1 text-sm font-medium text-blue-600 transition hover:bg-blue-50"
        >
          Rename
        </button>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 3 || trimmed.length > 100) {
      setError('Name must be between 3 and 100 characters.');
      return;
    }
    if (trimmed === currentName) {
      setIsEditing(false);
      setError('');
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      await onRename(trimmed);
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename workspace');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="rename-workspace" className="block text-xs font-medium text-slate-700">
        Workspace Name
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id="rename-workspace"
          type="text"
          required
          minLength={3}
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {isSubmitting ? 'Saving...' : 'Save'}
        </button>
        <button
          type="button"
          disabled={isSubmitting}
          onClick={() => { setIsEditing(false); setError(''); }}
          className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </form>
  );
}