import type { FastifyInstance } from 'fastify';
import type { Context } from './context.ts';

/**
 * Response headers and a per-address request budget. Cloudflare sits in front, but none of
 * this depends on it.
 */
export function registerSecurity(app: FastifyInstance, ctx: Context): void {
  const https = ctx.config.publicUrl.startsWith('https://');

  // Scripts and styles only from this site; pictures also from Discord's CDN (profile
  // pictures). Nothing may frame the site, and forms only post back to it.
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://cdn.discordapp.com https://mc-heads.net",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('content-security-policy', csp);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    reply.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header('cross-origin-resource-policy', 'same-origin');
    if (https) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    // Logged-in answers are never kept by a browser or a proxy.
    const url = req.url;
    if (url.startsWith('/api/') && !url.startsWith('/api/public/')) reply.header('cache-control', 'no-store');
    return payload;
  });

  // A request budget per address: generous for a dashboard, tight enough to slow scraping and
  // guessing. The mod's batch and live routes have their own, separate limits.
  const buckets = new Map<string, { n: number; reset: number }>();
  app.addHook('onRequest', async (req, reply) => {
    const url = req.url;
    if (url === '/healthz' || url.startsWith('/api/v1/batch') || url.startsWith('/api/v1/live') || !(url.startsWith('/api/') || url.startsWith('/auth/'))) return;
    const write = req.method !== 'GET' && req.method !== 'HEAD';
    // Per login when there is one, so friends behind the same router don't share a budget;
    // per address otherwise. An open dashboard page makes about 30 reads a minute.
    const session = req.headers.cookie?.match(/al_session=([^;]+)/)?.[1];
    const key = `${session ? `s:${session.slice(0, 16)}` : `ip:${req.ip}`}|${write ? 'w' : 'r'}`;
    const max = write ? 90 : 1200;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now >= b.reset) {
      if (buckets.size > 20_000) buckets.clear();
      b = { n: 0, reset: now + 60_000 };
      buckets.set(key, b);
    }
    if (++b.n > max) {
      reply.header('retry-after', Math.ceil((b.reset - now) / 1000));
      return reply.code(429).send({ error: 'slow_down' });
    }
  });
}
