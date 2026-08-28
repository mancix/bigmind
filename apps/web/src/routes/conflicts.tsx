import { Outlet, createFileRoute, Link, useMatchRoute } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';

import {
  conflictRepository,
} from '../features/conflicts/conflict-repository';
import {
  formatConflictDate,
  formatConflictType,
  formatEntityType,
  getEntityTitle,
} from '../features/conflicts/conflict-format';
import type { ConflictRecord } from '../storage/database';

export const Route = createFileRoute('/conflicts')({
  component: ConflictsPage,
});

function ConflictsPage() {
  const matchRoute = useMatchRoute();
  const openConflicts = useLiveQuery(
    () => conflictRepository.listOpen(),
    [],
  );
  const resolvedConflicts = useLiveQuery(
    () => conflictRepository.listResolved(),
    [],
  );
  const isDetail = matchRoute({ to: '/conflicts/$conflictId' });

  if (isDetail) {
    return <Outlet />;
  }

  const openCount = openConflicts?.length ?? 0;
  const resolvedCount = resolvedConflicts?.length ?? 0;
  const total = openCount + resolvedCount;

  return (
    <section className="mx-auto max-w-4xl">
      <header className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Conflicts</h1>
        <p className="mt-2 text-slate-500">
          Synchronization conflicts are kept here until you resolve them.
          Dismissed conflicts remain queryable.
        </p>
        {total === 0 ? (
          <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            No conflicts
          </p>
        ) : null}
      </header>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
        Open Conflicts {openCount > 0 ? <span className="text-red-600">({openCount})</span> : null}
      </h2>
      {openCount === 0 ? (
        <p className="text-sm text-slate-400">No open conflicts.</p>
      ) : (
        <ul className="space-y-3">
          {openConflicts?.map((conflict) => (
            <ConflictCard key={conflict.id} conflict={conflict} />
          ))}
        </ul>
      )}

      <h2 className="mt-8 mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
        Resolved Conflicts {resolvedCount > 0 ? <span className="text-slate-500">({resolvedCount})</span> : null}
      </h2>
      {resolvedCount === 0 ? (
        <p className="text-sm text-slate-400">No resolved conflicts.</p>
      ) : (
        <ul className="space-y-3">
          {resolvedConflicts?.map((conflict) => (
            <ConflictCard key={conflict.id} conflict={conflict} muted />
          ))}
        </ul>
      )}
    </section>
  );
}

function ConflictCard({
  conflict,
  muted = false,
}: {
  conflict: ConflictRecord;
  muted?: boolean;
}) {
  return (
    <li
      className={`rounded-lg border ${
        muted ? 'border-slate-200 bg-white' : 'border-amber-300 bg-amber-50'
      } p-4 shadow-sm transition hover:shadow`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900">
            {getEntityTitle(conflict) ?? formatEntityType(conflict.entityType)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {formatEntityType(conflict.entityType)} · {formatConflictType(conflict.conflictType)} · Created {formatConflictDate(conflict.createdAt)}
          </p>
          {muted && conflict.resolution ? (
            <p className="mt-1 text-xs text-slate-400">
              Resolved via {conflict.resolution}
              {conflict.resolvedAt ? ` on ${formatConflictDate(conflict.resolvedAt)}` : ''}
            </p>
          ) : null}
        </div>

        <Link
          to="/conflicts/$conflictId"
          params={{ conflictId: conflict.id }}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
        >
          {muted ? 'Review' : 'Resolve'}
        </Link>
      </div>
    </li>
  );
}