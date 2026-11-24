/* /changelog: every release from src/changelog.ts, newest first. */
import { channelOf, el, tag } from './site.ts';
import { CHANGELOG } from './changelog.ts';

const box = document.getElementById('changelog')!;
box.replaceChildren(
  ...CHANGELOG.map((r, i) => {
    const art = el('article', 'panel release');
    art.id = `v${r.version}`;
    art.setAttribute('aria-labelledby', `v${r.version}-h`);
    const side = el('div', 'release-side');
    const ver = el('a', 'px release-ver', r.version);
    ver.href = `#v${r.version}`;
    const tags = el('div', 'release-tags');
    tags.append(tag(channelOf(r.version)));
    if (i === 0) tags.append(el('span', 'px tag tag-latest', 'Latest'));
    const date = new Date(`${r.date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    side.append(ver, tags, el('span', 'muted small', date));
    const body = el('div', 'release-body prose');
    const h = el('h2', 'px', r.title);
    h.id = `v${r.version}-h`;
    body.append(h);
    for (const sec of r.sections) {
      body.append(el('h3', 'px', sec.heading));
      const ul = el('ul');
      for (const item of sec.items) ul.append(el('li', '', item));
      body.append(ul);
    }
    art.append(side, body);
    return art;
  }),
);
// The list is drawn by script, so jump to #v1.2.3 once it exists.
if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
