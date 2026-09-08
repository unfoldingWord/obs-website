// Sitemap generation (replaces @astrojs/sitemap so the inventory can be
// split: marketing pages with their hreflang cluster, and language hubs
// with lastmod from the catalog). robots.txt points at sitemap-index.xml.
import { locales, defaultLocale, localizedSlugs, englishOnlySlugs, localePath } from '../i18n/config';
import { languages, languagePath, storyPath } from '../data/catalog';
import { hasStories, storiesFor } from '../data/stories';
import { SITE_URL } from './jsonld';

export const SITE = SITE_URL;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function xmlResponse(body: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}

/**
 * Every story URL that has a page in THIS build: `storyNums` intersected with
 * the stories actually present in the language's story file. `storyNums`
 * alone is what a previous fetch found — the file it was written from is
 * gitignored, so a build can have the file with fewer stories in it (a fetch
 * that partly failed) and listing all of storyNums would advertise pages that
 * were never built. getStaticPaths and the hub already intersect this way.
 */
export async function storyUrls(): Promise<{ loc: string; lastmod: string | null }[]> {
  const urls: { loc: string; lastmod: string | null }[] = [];
  for (const l of languages) {
    // Only languages whose text is in this build — see hasStories().
    if (!hasStories(l.code)) continue;
    const built = new Set((await storiesFor(l.code)).map((s) => s.num));
    for (const num of l.storyNums ?? []) {
      if (!built.has(num)) continue;
      urls.push({ loc: `${SITE}${storyPath(l.code, num)}`, lastmod: l.updated ?? null });
    }
  }
  return urls;
}

/**
 * The sitemaps to advertise: the ones that actually have URLs. An empty
 * <urlset> is invalid against the sitemaps.org schema — Search Console
 * reports it as an empty sitemap — so a build with no story text (an outage,
 * or a fresh clone with no fetch) leaves sitemap-stories.xml out of the index
 * rather than advertising nothing.
 */
export async function sitemapFiles(): Promise<string[]> {
  const files = ['sitemap-pages.xml', 'sitemap-languages.xml'];
  if ((await storyUrls()).length > 0) files.push('sitemap-stories.xml');
  return files;
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

/**
 * Story pages, one entry per (language, story) that actually has text.
 *
 * Deliberately no hreflang alternates. Story N exists in ~214 languages, so a
 * reciprocal cluster would be roughly 214 × 10,700 ≈ 2.3M <xhtml:link>
 * elements — gigabytes, far past the 50MB per-sitemap limit. Issue #9's
 * "story-level hreflang belongs in the story sitemap" does not survive
 * contact with this many languages; the hub and marketing clusters stand.
 */
export async function storiesSitemap(): Promise<string> {
  const urls = (await storyUrls()).map(({ loc, lastmod }) => {
    const mod = lastmod ? `\n    <lastmod>${esc(lastmod)}</lastmod>` : '';
    return `  <url>\n    <loc>${loc}</loc>${mod}\n  </url>`;
  });
  return `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
}
