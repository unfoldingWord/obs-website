// Sitemap generation (replaces @astrojs/sitemap so the inventory can be
// split: marketing pages with their hreflang cluster, and language hubs
// with lastmod from the catalog). robots.txt points at sitemap-index.xml.
import { locales, defaultLocale, localizedSlugs, englishOnlySlugs, localePath } from '../i18n/config';
import { languages, languagePath } from '../data/catalog';
import { SITE_URL } from './jsonld';

export const SITE = SITE_URL;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function xmlResponse(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}

export function sitemapIndex(files: string[]): string {
  const items = files.map((f) => `  <sitemap><loc>${SITE}/${f}</loc></sitemap>`).join('\n');
  return `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</sitemapindex>\n`;
}

/** Marketing pages: every locale of every localized slug, each carrying the
 *  full reciprocal hreflang set + x-default (mirrors Base.astro's <link>s),
 *  plus the English-only legal pages. The 404 page is not a page. */
export function pagesSitemap(): string {
  const urls: string[] = [];
  for (const slug of localizedSlugs) {
    const alternates = [
      ...locales.map((l) => `    <xhtml:link rel="alternate" hreflang="${l.tag}" href="${SITE}${localePath(l.code, slug)}"/>`),
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${localePath(defaultLocale, slug)}"/>`,
    ].join('\n');
    for (const l of locales) {
      urls.push(`  <url>\n    <loc>${SITE}${localePath(l.code, slug)}</loc>\n${alternates}\n  </url>`);
    }
  }
  for (const slug of englishOnlySlugs) {
    if (slug === '404') continue;
    urls.push(`  <url>\n    <loc>${SITE}${localePath(defaultLocale, slug)}</loc>\n  </url>`);
  }
  return `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
}

/** Language hubs, one per published language, with lastmod from the most
 *  recent release. Story pages get their own file (and story-level hreflang)
 *  once they exist. */
export function languagesSitemap(): string {
  const urls = languages.map((l) => {
    const lastmod = l.updated ? `\n    <lastmod>${esc(l.updated)}</lastmod>` : '';
    return `  <url>\n    <loc>${SITE}${languagePath(l.code)}</loc>${lastmod}\n  </url>`;
  });
  return `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}
