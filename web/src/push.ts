import { api } from './api.ts';

/**
 * Browser notifications.
 *
 * The bug: when the server's key pair changes (state.db recreated, a reset, a new machine),
 * a browser that subscribed earlier keeps its old subscription. Turning notifications "on"
 * reused it, the server signed messages with the new key, the push service refused them
 * (403), and nothing was ever shown. Now the browser's subscription is checked against the
 * server's key and replaced when they differ; the server also drops subscriptions the push
 * service refuses, and every step reports why it stopped instead of "try again".
 */

export type PushState = 'on' | 'off' | 'blocked' | 'unsupported' | 'install' | 'server';

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** The service worker, registering it if the page hasn't yet (it only does in a production build). */
async function worker(): Promise<ServiceWorkerRegistration> {
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
  // `ready` waits for the worker to be active; never wait forever.
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<ServiceWorkerRegistration>((ok) => setTimeout(() => ok(reg), 5000)),
  ]);
}

function sameKey(sub: PushSubscription, key: Uint8Array): boolean {
  const have = sub.options.applicationServerKey;
  if (!have) return false;
  const a = new Uint8Array(have);
  return a.length === key.length && a.every((b, i) => b === key[i]);
}

/** What the settings page shows. */
export async function pushState(): Promise<PushState> {
  if (isIos() && !standalone()) return 'install'; // iPhone only allows it from the Home Screen app
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return 'off';
  const { publicKey, ready } = await api.pushKey();
  if (!ready) return 'server';
  return sameKey(sub, urlBase64(publicKey)) ? 'on' : 'off';
}

/** Turn notifications on for this browser. Returns a message saying what happened. */
export async function enablePush(): Promise<string> {
  const state = await pushState();
  if (state === 'install') return 'On iPhone and iPad: Share, Add to Home Screen, then open Arachne.fyi from there and turn this on.';
  if (state === 'unsupported') return "This browser can't show notifications from websites.";
  const { publicKey, ready } = await api.pushKey();
  if (!ready) return "The server can't send notifications yet (web-push isn't installed). Run start.bat again.";
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'Blocked. Click the lock icon next to the address, allow Notifications, then try again.';
  const key = urlBase64(publicKey);
  const reg = await worker();
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, key)) {
    await sub.unsubscribe(); // made for an older server key: useless now
    sub = null;
  }
  try {
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  } catch (err) {
    // Chrome refuses in incognito; Brave needs "Use Google services for push messaging".
    return `The browser's push service said no (${(err as Error).message}). Private windows and some privacy settings block it.`;
  }
  await api.pushSubscribe(sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } });
  return 'On. Use "Send a test" to check.';
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api.pushUnsubscribe(sub.endpoint).catch(() => null);
    await sub.unsubscribe();
  }
}

function urlBase64(base64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
