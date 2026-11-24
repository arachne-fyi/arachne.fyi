/*
 * Offline dev mode (start-offline.bat sets VITE_OFFLINE=1). Nothing here runs on the real site:
 * the flag is fixed at build time and normal builds never set it.
 */
export const OFFLINE = import.meta.env.VITE_OFFLINE === '1';

/** A made-up 8x8 pixel face from the UUID, so offline pages need no mc-heads.net. */
function localHead(uuid: string, size: number): string {
  let h = 2166136261;
  for (const c of uuid) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0), h / 4294967296);
  const skin = `hsl(${Math.floor(rnd() * 40) + 15} 45% ${Math.floor(rnd() * 30) + 45}%)`;
  const hair = `hsl(${Math.floor(rnd() * 360)} 40% ${Math.floor(rnd() * 25) + 15}%)`;
  let px = '';
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const fill = y < 2 || ((x === 0 || x === 7) && y < 4) ? hair : y === 4 && (x === 2 || x === 5) ? '#2b2118' : skin;
      px += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
    }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" width="${size}" height="${size}" shape-rendering="crispEdges">${px}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Minecraft head picture: mc-heads.net normally, a local stand-in offline. */
export const headUrl = (uuid: string, size: number) =>
  OFFLINE ? localHead(uuid, size) : `https://mc-heads.net/avatar/${encodeURIComponent(uuid)}/${size}`;

/** A small fixed strip so the offline copy is never mistaken for the real site. */
export function offlineBanner(): void {
  if (!OFFLINE || document.getElementById('offline-banner')) return;
  const b = document.createElement('div');
  b.id = 'offline-banner';
  b.textContent = 'Offline dev copy · saved data · read only, nothing is saved';
  b.setAttribute('role', 'status');
  Object.assign(b.style, {
    position: 'fixed', left: '50%', bottom: '8px', transform: 'translateX(-50%)', zIndex: '9999',
    background: '#ff8a1f', color: '#1a1410', font: '12px/1.4 system-ui, sans-serif', padding: '4px 10px',
    borderRadius: '4px', pointerEvents: 'none', whiteSpace: 'nowrap', opacity: '0.92',
  });
  document.body.append(b);
}
