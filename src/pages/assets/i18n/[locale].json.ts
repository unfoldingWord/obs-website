// Per-locale chrome strings, one static JSON file per marketing locale
// (/assets/i18n/es.json), generated from the same src/i18n/{locale}/*.json
// the pages render from.
//
// Why this exists: the language hubs and story pages are ONE URL each — there
// is no /es/l/bho/ — because 16 locale variants of ~9,000 story pages would be
// six figures of files against Cloudflare Pages' 20,000-file limit. Their
// chrome is therefore baked in one locale at build time, and a visitor whose
// preferred locale differs has it swapped in the browser
// (public/assets/js/locale.js) from this bundle. Nothing here is content: the
// story text, titles, autonyms and extracts are the translation teams' work
// and are never swapped.
import type { APIRoute } from 'astro';
import { locales, byCode, defaultLocale, localizedSlugs, slugPaths, fontHrefFor } from '../../../i18n/config';
import { content } from '../../../i18n/content';

export function getStaticPaths() {
  return locales.map((l) => ({ params: { locale: l.code } }));
}

/** Nested content to dotted keys: hub.faqStories.all, ui.nav.1.label. */
function flatten(value: unknown, prefix = '', out: Record<string, string> = {}) {
  if (typeof value === 'string') {
    out[prefix] = value;
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(v, `${prefix}.${i}`, out));
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

export const GET: APIRoute = ({ params }) => {
  const code = String(params.locale);
  const def = byCode(code);
  const strings = flatten({
    ui: content(code, 'ui'),
    hub: content(code, 'hub'),
    story: content(code, 'story'),
  });
  return new Response(
    JSON.stringify({
      locale: def.code,
      name: def.name,
      tag: def.tag,
      dir: def.dir,
      script: def.script,
      fontHref: fontHrefFor(def.code),
      // Enough of the URL scheme for the swap to rewrite nav and footer
      // hrefs; English-only slugs are absent and stay at the root.
      root: def.code === defaultLocale ? '/' : `/${def.code}/`,
      slugs: Object.fromEntries(localizedSlugs.map((s) => [s, slugPaths[s]])),
      strings,
    }),
    { headers: { 'content-type': 'application/json; charset=utf-8' } }
  );
};
