import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';

import { conflictRepository } from '../features/conflicts/conflict-repository';

export function ConflictIndicator() {
  const openCount = useLiveQuery(() => conflictRepository.countOpen(), []);

  const count = openCount ?? 0;
  if (count === 0) {
    return (
      <span className="text-xs text-slate-400" title="No conflicts">
        No conflicts
      </span>
    );
  }

  return (
    <Link
      to="/conflicts"
      className="text-xs font-medium text-red-600 transition hover:text-red-700"
      title={`${count} unresolved conflict${count === 1 ? '' : 's'}`}
    >
      {count} conflict{count === 1 ? '' : 's'}
    </Link>
  );
}