import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Context } from './context.ts';
import { GROUP_MAX, globalStats } from './platform.ts';
import { publicProfile } from './features.ts';
import { userByPublicName } from './fun.ts';

/**
 * Link previews. Discord, Slack, X and the rest read <meta> tags from the first HTML they
 * get and never run JavaScript, so the dashboard (a single-page app) can't set them itself.
 * The server writes them into the page before sending it, and draws a 1200 x 630 PNG card
 * per profile or group: SVG text over the Sanctuary panorama, turned into a PNG by resvg
 * (crawlers don't accept SVG images).
 */

// resvg is a native module with a prebuilt binary per platform; like web-push it is CommonJS.
type ResvgCtor = new (svg: string, opts: object) => { render(): { asPng(): Buffer } };
const { Resvg } = createRequire(import.meta.url)('@resvg/resvg-js') as { Resvg: ResvgCtor };

const HERE = dirname(fileURLToPath(import.meta.url));
const FONTS = ['arachne-regular.ttf', 'arachne-bold.ttf'].map((f) => join(HERE, '..', 'assets', f)).filter((f) => existsSync(f));

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const short = (v: number) =>
  Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : String(Math.round(v));

export interface Meta {
  title: string;
  description: string;
  image: string; // absolute URL
  url: string; // absolute URL
}

/** Put the tags in front of </head>. Values are escaped: names come from users. */
export function withMeta(html: string, m: Meta): string {
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Arachne.fyi" />`,
    `<meta property="og:title" content="${esc(m.title)}" />`,
    `<meta property="og:description" content="${esc(m.description)}" />`,
    `<meta property="og:url" content="${esc(m.url)}" />`,
    `<meta property="og:image" content="${esc(m.image)}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(m.title)}" />`,
    `<meta name="twitter:description" content="${esc(m.description)}" />`,
    `<meta name="twitter:image" content="${esc(m.image)}" />`,
    `<meta name="theme-color" content="#ffa62b" />`,
  ].join('\n    ');
  return html.replace('</head>', `    ${tags}\n  </head>`);
}

// ---- the picture --------------------------------------------------------------------

let background: string | null = null;
function backgroundUri(webDir: string): string {
  if (background !== null) return background;
  for (const p of ['bg/panorama/0.jpg', 'bg/sanctuary.jpg']) {
    const f = join(webDir, p);
    if (existsSync(f)) return (background = `data:image/jpeg;base64,${readFileSync(f).toString('base64')}`);
  }
  return (background = '');
}

interface Card {
  kicker: string; // small orange line at the top
  big: string; // the name
  sub: string; // under the name
  stats: [string, string][]; // up to three [value, label]
}

function cardSvg(c: Card, bg: string): string {
  const stats = c.stats
    .slice(0, 3)
    .map(
      ([v, l], i) => `<text x="${80 + i * 360}" y="500" font-size="72" font-weight="700" fill="${i === 0 ? '#ffa62b' : '#f5ecdb'}">${esc(v)}</text>
<text x="${80 + i * 360}" y="548" font-size="32" fill="#b8aa93">${esc(l)}</text>`,
    )
    .join('\n');
  const name = c.big.length > 18 ? `${c.big.slice(0, 17)}…` : c.big;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
${bg ? `<image href="${bg}" x="0" y="-285" width="1200" height="1200" preserveAspectRatio="xMidYMid slice"/>` : ''}
<rect width="1200" height="630" fill="#1b1510" fill-opacity="${bg ? 0.72 : 1}"/>
<rect x="6" y="6" width="1188" height="618" fill="none" stroke="#ffa62b" stroke-width="12"/>
<g font-family="Arachne Pixel" shape-rendering="crispEdges">
<text x="80" y="120" font-size="40" font-weight="700" fill="#ffa62b">${esc(c.kicker)}</text>
<text x="80" y="250" font-size="104" font-weight="700" fill="#f5ecdb">${esc(name)}</text>
<text x="80" y="320" font-size="40" fill="#b8aa93">${esc(c.sub)}</text>
${stats}
</g></svg>`;
}

const cache = new Map<string, { at: number; png: Buffer }>();
function png(key: string, make: () => string): Buffer {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.png;
  const out = new Resvg(make(), {
    fitTo: { mode: 'width', value: 1200 },
    font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Arachne Pixel' },
  })
    .render()
    .asPng();
  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), png: out });
  return out;
}

// ---- what each page says ---------------------------------------------------------------

export function registerOg(app: FastifyInstance, ctx: Context, webDir: string): void {
  const base = ctx.config.publicUrl;
  const pages = new Map<string, { mtime: number; html: string }>();
  const page = (file: string) => {
    const f = join(webDir, file);
    const mtime = statSync(f).mtimeMs;
    const hit = pages.get(file);
    if (hit && hit.mtime === mtime) return hit.html;
    const html = readFileSync(f, 'utf8');
    pages.set(file, { mtime, html });
    return html;
  };
  const send = (reply: FastifyReply, file: string, m: Meta) => reply.type('text/html; charset=utf-8').header('cache-control', 'no-cache').send(withMeta(page(file), m));

  const site = (): Meta => {
    const g = globalStats(ctx, Date.now());
    return {
      title: 'Arachne.fyi',
      description: `Track every Arachne fight, drop and coin. ${g.kills.toLocaleString('en-GB')} kills tracked so far.`,
      image: `${base}/og/site.png`,
      url: base,
    };
  };
  const groupByCode = (code: string) =>
    ctx.db.get<{ id: number; name: string; tag: string; description: string }>('SELECT id, name, tag, description FROM state.groups WHERE code = ?', code.toUpperCase());
  const members = (id: number) => ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM state.group_members WHERE group_id = ?', id)?.n ?? 0;

  // Pages
  app.get('/', (req, reply) => {
    const landing = !!ctx.config.landingHost && (req.hostname ?? '').toLowerCase().split(':')[0] === ctx.config.landingHost;
    return send(reply, landing ? 'landing.html' : 'index.html', site());
  });
  app.get('/u/:name', (req, reply) => {
    const name = (req.params as { name: string }).name;
    const user = userByPublicName(ctx, name);
    if (!user) return send(reply, 'profile.html', { ...site(), title: 'Profile not found: Arachne.fyi' });
    const p = publicProfile(ctx, user);
    const bits = [
      p.total.profit !== undefined && `${short(p.total.profit)} profit`,
      p.total.kills !== undefined && `${p.total.kills.toLocaleString('en-GB')} kills`,
      p.total.perHour != null && `${short(p.total.perHour)}/h`,
    ].filter(Boolean);
    return send(reply, 'profile.html', {
      title: `${p.name}${p.title ? `, ${p.title}` : ''} on Arachne.fyi`,
      description: bits.length ? `${bits.join(' · ')}. Arachne farming, tracked.` : 'Arachne farming, tracked.',
      image: `${base}/og/u/${encodeURIComponent(name)}.png`,
      url: `${base}/u/${encodeURIComponent(name)}`,
    });
  });
  app.get('/join/:code', (req, reply) => {
    const code = (req.params as { code: string }).code;
    const g = /^[A-Za-z0-9]{6}$/.test(code) ? groupByCode(code) : undefined;
    if (!g) return send(reply, 'index.html', site());
    return send(reply, 'index.html', {
      title: `Join [${g.tag}] ${g.name} on Arachne.fyi`,
      description: `${g.description || 'Track your Arachne farming together.'} ${members(g.id)} of ${GROUP_MAX} members.`,
      image: `${base}/og/join/${code.toUpperCase()}.png`,
      url: `${base}/join/${code.toUpperCase()}`,
    });
  });
  // A group's own page is private: its preview says only that it's Arachne.fyi.
  app.get('/groups/:id', (_req, reply) => send(reply, 'index.html', site()));

  // Pictures
  const image = (reply: FastifyReply, buf: Buffer) => reply.type('image/png').header('cache-control', 'public, max-age=600').send(buf);
  app.get('/og/site.png', (_req, reply) => {
    const g = globalStats(ctx, Date.now());
    return image(
      reply,
      png('site', () =>
        cardSvg({ kicker: 'Hypixel SkyBlock', big: 'Arachne.fyi', sub: 'Every Arachne fight, drop and coin', stats: [[short(g.coins), 'coins tracked'], [short(g.drops), 'drops'], [short(g.kills), 'kills']] }, backgroundUri(webDir)),
      ),
    );
  });
  app.get('/og/u/:name.png', (req, reply) => {
    const name = (req.params as { name: string }).name;
    const user = userByPublicName(ctx, name);
    if (!user) return reply.code(404).send({ error: 'no_profile' });
    const p = publicProfile(ctx, user);
    const stats: [string, string][] = [];
    if (p.total.profit !== undefined) stats.push([short(p.total.profit), 'profit']);
    if (p.total.kills !== undefined) stats.push([p.total.kills.toLocaleString('en-GB'), 'kills']);
    if (p.total.perHour != null) stats.push([short(p.total.perHour), 'per hour']);
    return image(reply, png(`u:${name}`, () => cardSvg({ kicker: 'Arachne.fyi', big: p.name, sub: p.title ?? 'Arachne farmer', stats }, backgroundUri(webDir))));
  });
  app.get('/og/join/:code.png', (req, reply) => {
    const code = (req.params as { code: string }).code;
    const g = /^[A-Za-z0-9]{6}$/.test(code) ? groupByCode(code) : undefined;
    if (!g) return reply.code(404).send({ error: 'unknown_group' });
    return image(
      reply,
      png(`g:${code}`, () => cardSvg({ kicker: `Group [${g.tag}]`, big: g.name, sub: 'Join on Arachne.fyi', stats: [[`${members(g.id)}/${GROUP_MAX}`, 'members']] }, backgroundUri(webDir))),
    );
  });
}
