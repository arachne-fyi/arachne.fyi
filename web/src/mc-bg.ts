/**
 * The spinning Spider's Den panorama behind every page (18 Nov 2026 Minecraft-style look).
 * A fixed layer under the page shows a blurred still at once; the WebGL panorama fades in
 * when its six faces have loaded. `dim` darkens it more, for the dashboard.
 */
import { PANORAMA_FACES, panoramaCanvas } from './panorama.ts';

export function mountPanorama(dim = false): void {
  if (document.querySelector('.mc-panorama')) return;
  const host = document.createElement('div');
  host.className = dim ? 'mc-panorama dim' : 'mc-panorama';
  host.setAttribute('aria-hidden', 'true');
  document.body.prepend(host);
  // Save data, or ask for less motion: keep the still picture.
  const saveData = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData;
  if (saveData || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const faces = PANORAMA_FACES.map((src) => {
    const img = new Image();
    img.src = src;
    return img;
  });
  Promise.all(faces.map((img) => img.decode()))
    .then(() => {
      const canvas = panoramaCanvas(faces);
      if (canvas) host.append(canvas);
    })
    .catch(() => {
      /* the still picture stays */
    });
}
