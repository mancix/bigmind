import type { Conflict } from './conflict.js';

export function isConflictResolved(
  conflict: Pick<Conflict, 'status'>,
): boolean {
  return conflict.status === 'resolved';
}

export function isConflictOpen(
  conflict: Pick<Conflict, 'status'>,
): boolean {
  return conflict.status === 'open';
}

export function isConflictDismissed(
  conflict: Pick<Conflict, 'status'>,
): boolean {
  return conflict.status === 'dismissed';
}

export function isConflictResolvedOrDismissed(
  conflict: Pick<Conflict, 'status'>,
): boolean {
  return conflict.status === 'resolved' || conflict.status === 'dismissed';
}

export function isActiveConflict(
  conflict: Pick<Conflict, 'status'>,
): boolean {
  return isConflictOpen(conflict);
}