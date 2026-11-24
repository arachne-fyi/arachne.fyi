import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * The public pages share one header and footer, kept in web/partials/. A page asks for them with
 *   <site-header page="help"></site-header>   (page marks that nav link as the current one)
 *   <site-footer></site-footer>
 * and this swaps them in at build time (and in `vite` dev), so there is no flash and no script needed.
 */
const dir = fileURLToPath(new URL('./partials/', import.meta.url));
const part = (name: string) => readFileSync(`${dir}${name}.html`, 'utf8').trim();

export function sitePartials(): Plugin {
  return {
    name: 'site-partials',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html
          .replace(/<site-header(?: page="([a-z]*)")?\s*><\/site-header>/g, (_m, page?: string) => {
            const header = part('header');
            return page ? header.replace(`data-page="${page}"`, `data-page="${page}" aria-current="page"`) : header;
          })
          .replace(/<site-footer\s*><\/site-footer>/g, () => part('footer'));
      },
    },
  };
}
