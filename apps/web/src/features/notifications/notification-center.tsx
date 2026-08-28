import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { Icon } from '../../components/icon';
import { notificationsRepository } from './notifications-repository';

function typeIcon(type: string): string {
  switch (type) {
    case 'reminder_due': return 'alarm';
    case 'note_modified': return 'note';
    case 'workspace_invitation': return 'mail';
    default: return 'notifications';
  }
}

export function NotificationCenter() {
  const notifications = useLiveQuery(() => notificationsRepository.list(), []) ?? [];
  const unreadCount = useLiveQuery(() => notificationsRepository.countUnread(), []) ?? 0;
  const [isOpen, setIsOpen] = useState(false);
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

  async function handleMarkAllRead() {
    await notificationsRepository.markAllRead();
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-label="Notifications"
        className="relative flex size-8 items-center justify-center rounded-md text-lg text-slate-500 hover:bg-slate-100"
      >
        <Icon name="notifications" className="text-[20px]" />
        {unreadCount > 0 && (
          <span className="absolute right-0 top-0 flex size-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="fixed bottom-16 left-3 z-50 w-80 rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
            <span className="text-sm font-semibold text-slate-700">Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void handleMarkAllRead()}
                className="text-xs text-blue-600 hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {notifications.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-slate-400">No notifications</li>
            )}
            {notifications.map((n) => (
              <li key={n.id} className={`flex gap-2 border-b border-slate-100 px-3 py-2 ${n.read ? 'opacity-60' : ''}`}>
                <Icon name={typeIcon(n.type)} className="mt-0.5 text-[18px] text-slate-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800">{n.title}</p>
                  {n.body && <p className="text-xs text-slate-500">{n.body}</p>}
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    {new Date(n.createdAt).toLocaleString()}
                  </p>
                </div>
                {!n.read && (
                  <button
                    type="button"
                    onClick={() => void notificationsRepository.markRead(n.id)}
                    aria-label="Mark as read"
                    className="self-start rounded p-0.5 text-slate-300 hover:text-blue-500"
                    title="Mark as read"
                  >
                    <Icon name="fiber_manual_record" className="text-[10px]" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void notificationsRepository.remove(n.id)}
                  aria-label="Delete notification"
                  className="self-start rounded p-0.5 text-slate-300 hover:text-red-500"
                  title="Delete"
                >
                  <Icon name="close" className="text-[14px]" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
