// Shared loading, offline and error states, in the app's voice.
import { useEffect, useState } from 'react';

export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    addEventListener('online', on); addEventListener('offline', off);
    return () => { removeEventListener('online', on); removeEventListener('offline', off); };
  }, []);
  return online;
}

type Query = { isLoading: boolean; error: unknown; refetch: () => unknown };

/** What to show while any query is loading or has failed, or null when all are ready. */
export function useLoadState(queries: Query[], what: string) {
  const online = useOnline();
  const failed = queries.filter(q => q.error);
  if (failed.length) {
    return (
      <div className="panel stack" role="alert">
        <p style={{ margin: 0 }}>{online ? `Couldn't load ${what}. Check your connection, then try again.` : `You're offline, so ${what} can't load.`}</p>
        <div><button type="button" onClick={() => failed.forEach(q => q.refetch())}>Try again</button></div>
      </div>
    );
  }
  if (queries.some(q => q.isLoading)) {
    return <p className="muted" role="status">{online ? 'Loading…' : `Waiting for a connection to load ${what}.`}</p>;
  }
  return null;
}

export function LoadState({ queries, what }: { queries: Query[]; what: string }) {
  return useLoadState(queries, what);
}

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return <p className="notice small offline" role="status">You're offline. Changes can't be saved until you're back online.</p>;
}
