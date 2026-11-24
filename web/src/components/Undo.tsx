import { useEffect, useState } from 'react';
import { useStreamStatus } from '../hooks.ts';

interface Pending {
  label: string;
  timer: ReturnType<typeof setTimeout>;
}
let pending: Pending | null = null;
const listeners = new Set<(p: Pending | null) => void>();
const emit = () => listeners.forEach((fn) => fn(pending));

/**
 * Do something that cannot be taken back (revoke a token, remove someone) after a short
 * wait, with an Undo button in the meantime.
 */
export function undoable(label: string, action: () => void, ms = 5_000): void {
  if (pending) {
    // A second action while one waits: run the first now.
    clearTimeout(pending.timer);
  }
  const timer = setTimeout(() => {
    pending = null;
    emit();
    action();
  }, ms);
  pending = { label, timer };
  emit();
}

export function UndoToast() {
  const [p, setP] = useState(pending);
  useEffect(() => {
    listeners.add(setP);
    return () => void listeners.delete(setP);
  }, []);
  if (!p) return null;
  return (
    <div className="toast" role="status">
      <span>{p.label}</span>
      <button
        type="button"
        onClick={() => {
          clearTimeout(p.timer);
          pending = null;
          emit();
        }}
      >
        Undo
      </button>
    </div>
  );
}

/** A thin bar when the live connection drops for more than a few seconds. */
export function OfflineBar() {
  const up = useStreamStatus();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (up) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), 5_000);
    return () => clearTimeout(t);
  }, [up]);
  if (!show) return null;
  return (
    <div className="offline-bar" role="status">
      Can't reach the server. Numbers may be out of date; it keeps trying by itself.
    </div>
  );
}
