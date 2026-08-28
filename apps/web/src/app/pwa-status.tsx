import { useRegisterSW } from 'virtual:pwa-register/react';

export function PwaStatus() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl) {
      console.info('Service worker registered:', swUrl);
    },

    onRegisterError(error) {
      console.error('Service worker registration failed:', error);
    },
  });

  if (!offlineReady && !needRefresh) {
    return null;
  }

  const close = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
  };

  return (
    <aside
      className="fixed bottom-4 right-4 max-w-sm rounded-xl border border-slate-200 bg-white p-4 shadow-lg"
      role="status"
    >
      <p className="text-sm text-slate-700">
        {offlineReady
          ? 'The app is ready to work offline.'
          : 'A new version of BigMind is available.'}
      </p>

      <div className="mt-3 flex gap-2">
        {needRefresh && (
          <button
            type="button"
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            onClick={() => updateServiceWorker(true)}
          >
            Update
          </button>
        )}

        <button
          type="button"
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          onClick={close}
        >
          Close
        </button>
      </div>
    </aside>
  );
}
