import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';

import { useWorkspaces } from './workspace-context';

export function WorkspaceSwitcher() {
  const { workspaces, currentWorkspace, switchWorkspace, addWorkspace, isLoading } =
    useWorkspaces();
  const navigate = useNavigate();

  const [isOpen, setIsOpen] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function handleSelect(workspaceId: string) {
    setIsOpen(false);
    await switchWorkspace(workspaceId);
  }

  function handleOpenModal() {
    setIsOpen(false);
    setName('');
    setDescription('');
    setError(null);
    setIsModalOpen(true);
  }

  async function handleCreateWorkspace(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName.length < 3 || trimmedName.length > 100) {
      setError('Workspace name must be between 3 and 100 characters.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await addWorkspace(trimmedName, description.trim() || null);
      setIsModalOpen(false);
      setName('');
      setDescription('');
      await navigate({ to: '/', search: { category: undefined } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading || !currentWorkspace) {
    return (
      <div className="px-3 py-2 text-sm text-slate-400">
        Loading workspaces...
      </div>
    );
  }

  return (
    <>
      <div ref={ref} className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs font-medium text-on-surface-variant transition hover:bg-surface-highest hover:text-on-surface"
        >
          <span className="min-w-0 flex-1 truncate">
            {currentWorkspace.name} Workspace
          </span>
          <span
            aria-hidden="true"
            className={`material-symbols-outlined ml-2 shrink-0 text-[16px] text-outline transition-transform ${
              isOpen ? 'rotate-180' : ''
            }`}
          >
            expand_more
          </span>
        </button>

        {isOpen && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                type="button"
                onClick={() => handleSelect(ws.id)}
                className={`flex w-full items-center px-3 py-2 text-left text-sm transition hover:bg-slate-100 ${
                  ws.id === currentWorkspace.id
                    ? 'bg-blue-50 font-medium text-blue-700'
                    : 'text-slate-700'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{ws.name} Workspace</span>
                <span
                  className="ml-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                  style={{
                    backgroundColor:
                      ws.role === 'OWNER'
                        ? 'rgb(219 234 254)'
                        : ws.role === 'EDITOR'
                          ? 'rgb(220 252 231)'
                          : 'rgb(243 244 246)',
                    color:
                      ws.role === 'OWNER'
                        ? 'rgb(30 64 175)'
                        : ws.role === 'EDITOR'
                          ? 'rgb(22 101 52)'
                          : 'rgb(107 114 128)',
                  }}
                >
                  {ws.role}
                </span>
              </button>
            ))}

            <div className="my-1 border-t border-slate-100" />

            <button
              type="button"
              onClick={handleOpenModal}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-blue-600 transition hover:bg-blue-50"
            >
              <span className="text-base font-bold">+</span>
              <span>Create Workspace</span>
            </button>
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-semibold text-slate-800">Create Workspace</h2>
            <p className="mt-1 text-sm text-slate-500">
              Create a new workspace to collaborate or organize separate projects.
            </p>

            {error && (
              <div className="mt-4 rounded-lg bg-red-50 p-3 text-xs text-red-600">
                {error}
              </div>
            )}

            <form onSubmit={handleCreateWorkspace} className="mt-4 space-y-4">
              <div>
                <label htmlFor="workspace-name" className="block text-xs font-medium text-slate-700">
                  Workspace Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="workspace-name"
                  type="text"
                  required
                  minLength={3}
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Acme Corp Notes"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="workspace-description" className="block text-xs font-medium text-slate-700">
                  Description <span className="text-slate-400">(optional)</span>
                </label>
                <textarea
                  id="workspace-description"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What is this workspace used for?"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || name.trim().length < 3}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSubmitting ? 'Creating...' : 'Create Workspace'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}