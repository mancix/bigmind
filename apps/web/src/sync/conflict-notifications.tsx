import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';

import {
  subscribeToConflictCreations,
} from '../features/conflicts/conflict-repository';

const NOTIFICATION_TIMEOUT_MS = 8_000;

interface ActiveNotification {
  id: string;
  conflictId: string;
}

export function ConflictNotifications() {
  const [notifications, setNotifications] = useState<ActiveNotification[]>([]);

  useEffect(() => {
    let cancelled = false;

    const unsubscribe = subscribeToConflictCreations((conflict) => {
      if (cancelled) return;
      const notification: ActiveNotification = {
        id: crypto.randomUUID(),
        conflictId: conflict.id,
      };

      setNotifications((current) => [notification, ...current].slice(0, 3));

      window.setTimeout(() => {
        if (cancelled) return;
        setNotifications((current) =>
          current.filter((entry) => entry.id !== notification.id),
        );
      }, NOTIFICATION_TIMEOUT_MS);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  function dismiss(id: string) {
    setNotifications((current) => current.filter((entry) => entry.id !== id));
  }

  if (notifications.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 left-4 z-40 flex max-w-sm flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 shadow-lg"
        >
          <p className="min-w-0 flex-1">
            Synchronization conflict detected.
            <Link
              to="/conflicts/$conflictId"
              params={{ conflictId: notification.conflictId }}
              onClick={() => dismiss(notification.id)}
              className="ml-2 inline-block font-medium text-amber-700 underline hover:text-amber-900"
            >
              Review
            </Link>
          </p>
          <button
            type="button"
            onClick={() => dismiss(notification.id)}
            aria-label="Dismiss notification"
            className="text-amber-700 hover:text-amber-900"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}