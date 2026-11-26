import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Live updates. The server sends a small "something changed" message over one
 * Server-Sent Events connection; every `useLive` hook then refetches its own data.
 * The stream carries no data itself, so a missed message costs nothing: a slow
 * interval refetch catches up.
 */
type Listener = () => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;
let connected = false;
const statusListeners = new Set<(up: boolean) => void>();
/** Told when a boss spawns or dies (the mod's instant packets), so fight timers start on time. */
const bossListeners = new Set<Listener>();

function ensureStream() {
  if (source) return;
  source = new EventSource('/api/stream');
  const poke = () => listeners.forEach((fn) => fn());
  source.addEventListener('ingest', poke);
  source.addEventListener('prices', poke);
  source.addEventListener('settings', poke);
  source.addEventListener('boss', () => bossListeners.forEach((fn) => fn()));
  source.onopen = () => {
    connected = true;
    statusListeners.forEach((fn) => fn(true));
    poke(); // anything missed while disconnected
  };
  source.onerror = () => {
    connected = false;
    statusListeners.forEach((fn) => fn(false));
    // EventSource reconnects on its own.
  };
}

/** Call `fn` whenever a boss spawns or dies. Returns the unsubscribe function. */
export function onBoss(fn: Listener): () => void {
  ensureStream();
  bossListeners.add(fn);
  return () => void bossListeners.delete(fn);
}

export function closeStream() {
  source?.close();
  source = null;
  connected = false;
}

/** True while the live connection is open. */
export function useStreamStatus(): boolean {
  const [up, setUp] = useState(connected);
  useEffect(() => {
    statusListeners.add(setUp);
    return () => void statusListeners.delete(setUp);
  }, []);
  return up;
}

export interface Live<T> {
  data: T | undefined;
  error: string | null;
  refresh: () => void;
}

/**
 * Fetch `load()` now, again whenever the server says something changed, and every
 * `everyMs` as a safety net. Pass `deps` like useEffect: the fetch restarts when they change.
 */
export function useLive<T>(load: () => Promise<T>, deps: unknown[], everyMs = 20_000): Live<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const generation = useRef(0);

  const refresh = useCallback(() => {
    const mine = ++generation.current;
    loadRef
      .current()
      .then((value) => {
        // Ignore replies that arrive after a newer request was started.
        if (mine === generation.current) {
          setData(value);
          setError(null);
        }
      })
      .catch((err: Error) => mine === generation.current && setError(err.message));
  }, []);

  useEffect(() => {
    ensureStream();
    refresh();
    // Several events can arrive together (three accounts batching at once); refetch once.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 400);
    };
    listeners.add(onChange);
    // 0 means "load once": setInterval(fn, 0) would refetch as fast as the browser can.
    const interval = everyMs > 0 ? setInterval(refresh, everyMs) : undefined;
    return () => {
      listeners.delete(onChange);
      clearTimeout(timer);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, refresh };
}

/** A clock that ticks, for "12s ago" labels and running timers. */
export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/** Minimal client-side routing: the path is the page. The server sends index.html for every path. */
export function usePath(): [string, (to: string) => void] {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const go = useCallback((to: string) => {
    window.history.pushState(null, '', to);
    setPath(to);
    window.scrollTo(0, 0);
  }, []);
  return [path, go];
}

/** Refetch everything on the page (pull to refresh, the R shortcut). */
export function refreshAll(): void {
  listeners.forEach((fn) => fn());
}
