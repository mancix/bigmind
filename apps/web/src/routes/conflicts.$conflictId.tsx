import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  createFileRoute,
  Link,
  notFound,
  useNavigate,
} from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { wouldCreateCategoryCycle } from '@bigmind/domain/categories';

import {
  ConflictRepositoryError,
  conflictRepository,
} from '../features/conflicts/conflict-repository';
import {
  formatConflictDate,
  formatConflictType,
  formatEntityType,
  getEntityTitle,
} from '../features/conflicts/conflict-format';
import { categoryRepository } from '../features/categories/category-repository';
import {
  type CategoryRecord,
  type ConflictRecord,
  type NoteRecord,
} from '../storage';

export const Route = createFileRoute('/conflicts/$conflictId')({
  loader: async ({ params }) => {
    const conflict = await conflictRepository.find(params.conflictId);

    if (!conflict) {
      throw notFound();
    }

    return { conflictId: conflict.id };
  },
  component: ConflictDetailPage,
});

function ConflictDetailPage() {
  const { conflictId } = Route.useLoaderData();
  const navigate = useNavigate();
  const conflict = useLiveQuery(
    () => conflictRepository.find(conflictId),
    [conflictId],
  );

  if (conflict === undefined) {
    return <p className="text-sm text-slate-500">Loading conflict...</p>;
  }

  if (!conflict) {
    return (
      <section>
        <h1 className="text-2xl font-semibold">Conflict not found</h1>
        <Link
          to="/conflicts"
          className="mt-4 inline-block text-blue-600 hover:underline"
        >
          Back to conflicts
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-4xl">
      <header className="mb-6">
        <Link
          to="/conflicts"
          className="text-sm font-medium text-slate-500 hover:text-slate-900"
        >
          ← All conflicts
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">
          {getEntityTitle(conflict) ?? 'Conflicting entity'}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {formatEntityType(conflict.entityType)} ·{' '}
          {formatConflictType(conflict.conflictType)} · Created{' '}
          {formatConflictDate(conflict.createdAt)}
        </p>
        {conflict.status !== 'open' ? (
          <p className="mt-2 text-xs text-slate-400">
            {conflict.status === 'dismissed' ? 'Dismissed' : 'Resolved'} via{' '}
            {conflict.resolution}
            {conflict.resolvedAt
              ? ` on ${formatConflictDate(conflict.resolvedAt)}`
              : ''}
          </p>
        ) : null}
      </header>

      <ConflictDetailView
        conflict={conflict}
        onResolved={() => void navigate({ to: '/conflicts' })}
      />
    </section>
  );
}

function ConflictDetailView({
  conflict,
  onResolved,
}: {
  conflict: ConflictRecord;
  onResolved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [mergeContent, setMergeContent] = useState<string>('');

  useEffect(() => {
    if (conflict.conflictType === 'content') {
      const local = conflict.localSnapshot.entity as NoteRecord | undefined;
      const remote = conflict.remoteSnapshot.entity as NoteRecord | undefined;
      setMergeContent(mergeContent || local?.content || remote?.content || '');
    }
  }, [conflict, mergeContent]);

  async function run(
    strategy:
      | 'keep_mine'
      | 'keep_remote'
      | 'merge_manually'
      | 'restore'
      | 'delete_mine',
  ) {
    if (conflict.status !== 'open') return;

    setIsBusy(true);
    setError(null);

    try {
      if (strategy === 'merge_manually') {
        await conflictRepository.resolveMergeManually(conflict.id, {
          content: mergeContent,
        });
      } else {
        await conflictRepository.resolve(conflict.id, strategy);
      }
      onResolved();
    } catch (err) {
      if (err instanceof ConflictRepositoryError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Unable to resolve the conflict.');
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDismiss() {
    setIsBusy(true);
    setError(null);
    try {
      await conflictRepository.dismiss(conflict.id);
      onResolved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to dismiss.');
    } finally {
      setIsBusy(false);
    }
  }

  if (conflict.conflictType === 'delete_vs_edit') {
    return (
      <DeleteVsEditView
        conflict={conflict}
        isBusy={isBusy}
        error={error}
        onKeep={handleDismiss}
        onRestore={() => void run('restore')}
        onDeleteMine={() => void run('delete_mine')}
      />
    );
  }

  if (conflict.conflictType === 'category_move') {
    return (
      <CategoryMoveView
        conflict={conflict}
        isBusy={isBusy}
        error={error}
        onKeepMine={() => void run('keep_mine')}
        onKeepRemote={() => void run('keep_remote')}
        onDismiss={handleDismiss}
      />
    );
  }

  if (conflict.conflictType === 'rename' && conflict.entityType === 'note') {
    return (
      <RenameNoteView
        conflict={conflict}
        isBusy={isBusy}
        error={error}
        onKeepMine={() => void run('keep_mine')}
        onKeepRemote={() => void run('keep_remote')}
        onDismiss={handleDismiss}
        onUseCustom={async (custom) => {
          setIsBusy(true);
          setError(null);
          try {
            await conflictRepository.resolveMergeManually(conflict.id, {
              title: custom,
            });
            onResolved();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Unable to resolve.');
          } finally {
            setIsBusy(false);
          }
        }}
      />
    );
  }

  if (conflict.conflictType === 'content' && conflict.entityType === 'note') {
    return (
      <ContentView
        conflict={conflict}
        mergeContent={mergeContent}
        setMergeContent={setMergeContent}
        isBusy={isBusy}
        error={error}
        onKeepMine={() => void run('keep_mine')}
        onKeepRemote={() => void run('keep_remote')}
        onMerge={(event: FormEvent) => {
          event.preventDefault();
          void run('merge_manually');
        }}
        onDismiss={handleDismiss}
      />
    );
  }

  return (
    <GenericView
      conflict={conflict}
      isBusy={isBusy}
      error={error}
      onKeepMine={() => void run('keep_mine')}
      onKeepRemote={() => void run('keep_remote')}
      onDismiss={handleDismiss}
    />
  );
}

type ChildProps = {
  conflict: ConflictRecord;
  isBusy: boolean;
  error: string | null;
};

function ButtonRow({ children }: { children: React.ReactNode }) {
  return <div className="mt-6 flex flex-wrap gap-3">{children}</div>;
}

function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {error}
    </p>
  );
}

function ResolutionButtons({
  onKeepMine,
  onKeepRemote,
  onDismiss,
  isBusy,
  extra,
}: {
  onKeepMine: () => void;
  onKeepRemote: () => void;
  onDismiss?: () => void;
  isBusy: boolean;
  extra?: React.ReactNode;
}) {
  return (
    <ButtonRow>
      <button
        type="button"
        onClick={onKeepMine}
        disabled={isBusy}
        className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-400"
      >
        Keep Mine
      </button>
      <button
        type="button"
        onClick={onKeepRemote}
        disabled={isBusy}
        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:bg-slate-100"
      >
        Keep Remote
      </button>
      {extra}
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          disabled={isBusy}
          className="ml-auto rounded-md px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-900"
        >
          Dismiss
        </button>
      ) : null}
    </ButtonRow>
  );
}

function GenericView({
  conflict,
  isBusy,
  error,
  onKeepMine,
  onKeepRemote,
  onDismiss,
}: ChildProps & {
  onKeepMine: () => void;
  onKeepRemote: () => void;
  onDismiss: () => void;
}) {
  return (
    <div>
      <EntityInfo conflict={conflict} />
      <SideBySide conflict={conflict} />
      <ErrorBanner error={error} />
      <ResolutionButtons
        onKeepMine={onKeepMine}
        onKeepRemote={onKeepRemote}
        onDismiss={onDismiss}
        isBusy={isBusy}
      />
    </div>
  );
}

function ContentView({
  conflict,
  mergeContent,
  setMergeContent,
  isBusy,
  error,
  onKeepMine,
  onKeepRemote,
  onMerge,
  onDismiss,
}: ChildProps & {
  mergeContent: string;
  setMergeContent: (value: string) => void;
  onKeepMine: () => void;
  onKeepRemote: () => void;
  onMerge: (event: FormEvent) => void;
  onDismiss: () => void;
}) {
  const local = conflict.localSnapshot.entity as NoteRecord | undefined;
  const remote = conflict.remoteSnapshot.entity as NoteRecord | undefined;

  return (
    <div>
      <EntityInfo conflict={conflict} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Column title="Local changes">
          <pre className="whitespace-pre-wrap text-sm text-slate-800">
            {local?.content ?? ''}
          </pre>
        </Column>
        <Column title="Remote changes">
          <pre className="whitespace-pre-wrap text-sm text-slate-800">
            {remote?.content ?? ''}
          </pre>
        </Column>
      </div>
      <Column title="Merge manually">
        <textarea
          value={mergeContent}
          onChange={(event) => setMergeContent(event.target.value)}
          rows={10}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-mono text-slate-800"
          placeholder="Edit the merged content here"
        />
      </Column>
      <ErrorBanner error={error} />
      <ButtonRow>
        <button
          type="button"
          onClick={onKeepMine}
          disabled={isBusy}
          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-400"
        >
          Keep Mine
        </button>
        <button
          type="button"
          onClick={onKeepRemote}
          disabled={isBusy}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:bg-slate-100"
        >
          Keep Remote
        </button>
        <button
          type="button"
          form="merge-form"
          onClick={onMerge}
          disabled={isBusy}
          className="rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
        >
          Merge Manually
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={isBusy}
          className="ml-auto rounded-md px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-900"
        >
          Dismiss
        </button>
      </ButtonRow>
    </div>
  );
}

function RenameNoteView({
  conflict,
  isBusy,
  error,
  onKeepMine,
  onKeepRemote,
  onDismiss,
  onUseCustom,
}: ChildProps & {
  onKeepMine: () => void;
  onKeepRemote: () => void;
  onDismiss: () => void;
  onUseCustom: (custom: string) => Promise<void>;
}) {
  const local = conflict.localSnapshot.entity as NoteRecord | undefined;
  const remote = conflict.remoteSnapshot.entity as NoteRecord | undefined;
  const [customTitle, setCustomTitle] = useState('');

  return (
    <div>
      <EntityInfo conflict={conflict} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Column title="Local title">
          <p className="text-sm text-slate-800">{local?.title ?? ''}</p>
        </Column>
        <Column title="Remote title">
          <p className="text-sm text-slate-800">{remote?.title ?? ''}</p>
        </Column>
      </div>
      <Column title="Custom title (optional)">
        <input
          type="text"
          value={customTitle}
          onChange={(event) => setCustomTitle(event.target.value)}
          placeholder="Enter a new title..."
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
        />
      </Column>
      <ErrorBanner error={error} />
      <ButtonRow>
        <button
          type="button"
          onClick={onKeepMine}
          disabled={isBusy}
          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-400"
        >
          Keep Mine
        </button>
        <button
          type="button"
          onClick={onKeepRemote}
          disabled={isBusy}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:bg-slate-100"
        >
          Keep Remote
        </button>
        <button
          type="button"
          onClick={() =>
            customTitle.trim()
              ? void onUseCustom(customTitle.trim())
              : undefined
          }
          disabled={isBusy}
          className="rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
        >
          Use Custom Title
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={isBusy}
          className="ml-auto rounded-md px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-900"
        >
          Dismiss
        </button>
      </ButtonRow>
    </div>
  );
}

function CategoryMoveView({
  conflict,
  isBusy,
  error,
  onKeepMine,
  onKeepRemote,
  onDismiss,
}: ChildProps & {
  onKeepMine: () => void;
  onKeepRemote: () => void;
  onDismiss: () => void;
}) {
  const local = conflict.localSnapshot.entity as CategoryRecord | undefined;
  const remote = conflict.remoteSnapshot.entity as CategoryRecord | undefined;
  const categoriesLiveData = useLiveQuery(() => categoryRepository.list(), []);
  const categories = useMemo(
    () => categoriesLiveData ?? [],
    [categoriesLiveData],
  );

  const localParentName = useMemo(
    () =>
      (local?.parentId
        ? categories.find((c) => c.id === local.parentId)?.name
        : 'No parent') ?? 'No parent',
    [categories, local],
  );
  const remoteParentName = useMemo(
    () =>
      (remote?.parentId
        ? categories.find((c) => c.id === remote.parentId)?.name
        : 'No parent') ?? 'No parent',
    [categories, remote],
  );

  return (
    <div>
      <EntityInfo conflict={conflict} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Column title="Current parent">
          <p className="text-sm text-slate-800">
            {categories.find((c) => c.id === local?.parentId)?.name ??
              'No parent'}
          </p>
        </Column>
        <Column title="Local parent">
          <p className="text-sm text-slate-800">{localParentName}</p>
        </Column>
        <Column title="Remote parent">
          <p className="text-sm text-slate-800">{remoteParentName}</p>
        </Column>
      </div>
      <CategoryCycleWarning conflict={conflict} categories={categories} />
      <ErrorBanner error={error} />
      <ResolutionButtons
        onKeepMine={onKeepMine}
        onKeepRemote={onKeepRemote}
        onDismiss={onDismiss}
        isBusy={isBusy}
      />
    </div>
  );
}

function CategoryCycleWarning({
  conflict,
  categories,
}: {
  conflict: ConflictRecord;
  categories: CategoryRecord[];
}) {
  const remote = conflict.remoteSnapshot.entity as CategoryRecord | undefined;

  const warning = useMemo(() => {
    if (!remote?.parentId) return null;
    const others = categories.filter((c) => c.id !== conflict.entityId);
    if (wouldCreateCategoryCycle(others, conflict.entityId, remote.parentId)) {
      return 'Accepting the remote move would create a cycle. Choose Keep Mine or move the affected category first.';
    }
    return null;
  }, [categories, remote, conflict.entityId]);

  return warning ? (
    <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      {warning}
    </p>
  ) : null;
}

function DeleteVsEditView({
  conflict,
  isBusy,
  error,
  onKeep,
  onRestore,
  onDeleteMine,
}: ChildProps & {
  onKeep: () => void;
  onRestore: () => void;
  onDeleteMine: () => void;
}) {
  return (
    <div>
      <EntityInfo conflict={conflict} />
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        This note was deleted on another device while you edited it locally.
      </p>
      <ErrorBanner error={error} />
      <ButtonRow>
        <button
          type="button"
          onClick={onRestore}
          disabled={isBusy}
          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-400"
        >
          Restore Note
        </button>
        <button
          type="button"
          onClick={onDeleteMine}
          disabled={isBusy}
          className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          Delete Mine
        </button>
        <button
          type="button"
          onClick={onKeep}
          disabled={isBusy}
          className="ml-auto rounded-md px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-900"
        >
          Dismiss
        </button>
      </ButtonRow>
    </div>
  );
}

function EntityInfo({ conflict }: { conflict: ConflictRecord }) {
  return (
    <dl className="mb-6 grid grid-cols-2 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
      <div>
        <dt className="text-xs uppercase text-slate-500">Entity type</dt>
        <dd className="text-slate-800">
          {formatEntityType(conflict.entityType)}
        </dd>
      </div>
      <div>
        <dt className="text-xs uppercase text-slate-500">Local version</dt>
        <dd className="text-slate-800">{conflict.localVersion}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase text-slate-500">Remote version</dt>
        <dd className="text-slate-800">{conflict.remoteVersion}</dd>
      </div>
      <div>
        <dt className="text-xs uppercase text-slate-500">Created</dt>
        <dd className="text-slate-800">
          {formatConflictDate(conflict.createdAt)}
        </dd>
      </div>
    </dl>
  );
}

function SideBySide({ conflict }: { conflict: ConflictRecord }) {
  const local = conflict.localSnapshot.entity as NoteRecord | undefined;
  const remote = conflict.remoteSnapshot.entity as NoteRecord | undefined;
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Column title="Local changes">
        <pre className="whitespace-pre-wrap text-sm text-slate-800">
          {local?.content ?? '-'}
        </pre>
      </Column>
      <Column title="Remote changes">
        <pre className="whitespace-pre-wrap text-sm text-slate-800">
          {remote?.content ?? '-'}
        </pre>
      </Column>
    </div>
  );
}

function Column({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      <div className="min-h-8 text-slate-700">{children}</div>
    </div>
  );
}
