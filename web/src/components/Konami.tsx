import { useEffect } from 'react';
import { remember, remembered } from '../settings.ts';

const CODE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

/** Up up down down left right left right B A: the Queen theme (purple instead of orange). Again to undo. */
export function Konami() {
  useEffect(() => {
    if (remembered('queen') === '1') document.body.classList.add('queen');
    let at = 0;
    const key = (e: KeyboardEvent) => {
      at = e.key === CODE[at] ? at + 1 : e.key === CODE[0] ? 1 : 0;
      if (at === CODE.length) {
        at = 0;
        const on = document.body.classList.toggle('queen');
        remember('queen', on ? '1' : '0');
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return null;
}
