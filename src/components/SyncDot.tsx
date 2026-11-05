import { useEffect, useState } from 'react';

type Status = 'off' | 'idle' | 'syncing' | 'error' | 'offline';

/** Tiny cloud-sync indicator. Loads the sync module lazily so the shell never blocks on it. */
export function SyncDot() {
  const [status, setStatus] = useState<Status>('off');
  useEffect(() => {
    let unsub: (() => void) | undefined;
    import('../lib/cloudsync')
      .then((m) => {
        const store = (m as unknown as { useCloudSync?: { getState: () => { status: Status }; subscribe: (f: (s: { status: Status }) => void) => () => void } }).useCloudSync;
        if (!store?.getState) return;
        setStatus(store.getState().status);
        unsub = store.subscribe((s) => setStatus(s.status));
      })
      .catch(() => setStatus('off'));
    return () => unsub?.();
  }, []);
  if (status === 'off') return null;
  const label = { idle: 'Synced', syncing: 'Syncing', error: 'Sync failed', offline: 'Offline' }[status];
  return <span className={`sync-dot ${status}`} title={label} role="status" aria-label={label} />;
}
