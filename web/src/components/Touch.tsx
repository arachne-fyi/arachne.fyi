import { useEffect, useRef, useState } from 'react';
import { refreshAll } from '../hooks.ts';

/**
 * Phone helpers that work across the whole app:
 *  - tap anything with a note (data-tip) to show it, tap elsewhere to hide it
 *  - pull down at the top of the page to refresh
 */
export function TouchHelpers() {
  const [pull, setPull] = useState<'idle' | 'pulling' | 'release' | 'done'>('idle');
  const start = useRef<number | null>(null);

  useEffect(() => {
    const tap = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      const target = (e.target as Element).closest('[data-tip]');
      document.querySelectorAll('.tip-open').forEach((el) => el !== target && el.classList.remove('tip-open'));
      target?.classList.toggle('tip-open');
    };
    const down = (e: TouchEvent) => {
      start.current = window.scrollY <= 0 ? e.touches[0]!.clientY : null;
    };
    const move = (e: TouchEvent) => {
      if (start.current == null) return;
      const d = e.touches[0]!.clientY - start.current;
      setPull(d > 90 ? 'release' : d > 20 ? 'pulling' : 'idle');
    };
    const up = () => {
      setPull((p) => {
        if (p === 'release') {
          refreshAll();
          setTimeout(() => setPull('idle'), 900);
          return 'done';
        }
        return 'idle';
      });
      start.current = null;
    };
    document.addEventListener('pointerup', tap);
    window.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', up);
    return () => {
      document.removeEventListener('pointerup', tap);
      window.removeEventListener('touchstart', down);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', up);
    };
  }, []);

  if (pull === 'idle') return null;
  return (
    <div className="pull" role="status">
      {pull === 'pulling' ? 'Pull to refresh' : pull === 'release' ? 'Let go to refresh' : 'Refreshing…'}
    </div>
  );
}

/** Left/right swipes on an element: for flicking between the chart tabs. */
export function useSwipe(onLeft: () => void, onRight: () => void) {
  const from = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (e: React.TouchEvent) => {
      from.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY };
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const f = from.current;
      from.current = null;
      if (!f) return;
      const dx = e.changedTouches[0]!.clientX - f.x;
      const dy = e.changedTouches[0]!.clientY - f.y;
      // Mostly sideways and far enough: a swipe, not a scroll.
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) (dx < 0 ? onLeft : onRight)();
    },
  };
}
