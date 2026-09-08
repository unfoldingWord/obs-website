// Markdown mirrors of the story text, and the /llms.txt index that lists
// them (#20).
//
// This is a convenience layer, not a substitute for the HTML: Google has
// said no special AI file is required, and the hubs and story pages remain
// the canonical URLs. What it buys is the fetchers that would rather read
// markdown than parse a page — Perplexity-style crawlers, custom MCP tools,
// anyone building a corpus from an open-licensed source — getting the whole
// of a language in one request instead of 50.
//
// Two rules, both from the issue:
//
//   1. Nothing is listed that does not 200. Every URL in llms.txt is built
//      from the same catalog and story files the pages are built from, and
//      `npm run check:routes` re-reads the served file and fails if any of
//      its URLs has no file behind it.
//   2. One file per LANGUAGE, not per story. `/content/{code}/{story}.md`
//      would be another ~9,000 files on top of ~9,300 pages, and Cloudflare
//      Pages refuses a deployment over 20,000 files. `/content/{code}.md`
//      carries the same text in ~200 files.
import { languages, languagePath, storyPath, displayName, publishersOf, type CatalogLanguage } from '../data/catalog';
import { hasStories, storiesFor, type Story } from '../data/stories';
import { locales, localePath, localizedSlugs } from '../i18n/config';
import { content } from '../i18n/content';
import { SITE_URL, PRODUCT_NAME, DEFINITION, LICENSE_URL } from './jsonld';

/** Path of a language's markdown mirror. */
export function markdownPath(code: string): string {
  return `/content/${encodeURIComponent(code)}.md`;
}

export function textResponse(body: string, contentType = 'text/plain; charset=utf-8'): Response {
  return new Response(body, { headers: { 'Content-Type': contentType } });
}

/** Languages whose story text is in THIS build — the only ones with a
 *  mirror, and the only ones llms.txt may name one for. */
export function mirroredLanguages(): CatalogLanguage[] {
  return languages.filter((l) => hasStories(l.code) && (l.storyNums ?? []).length > 0);
}

const ATTRIBUTION = `The original work by unfoldingWord is available from ${SITE_URL}`;

/**
 * One language's complete text as markdown: the same words as the story
 * pages, with the same illustrations and the attribution the license
 * requires. Frames are kept as image + paragraph pairs so the mirror does
 * not silently drop which picture belongs to which sentence.
 */
export async function languageMarkdown(lang: CatalogLanguage): Promise<string> {
  const name = displayName(lang);
  const stories = await storiesFor(lang.code);
  const built = new Set(lang.storyNums ?? []);
  const included = stories.filter((s) => built.has(s.num));

  const head = [
    `# ${PRODUCT_NAME} — ${name}${lang.englishName && lang.englishName !== name ? ` (${lang.englishName})` : ''}`,
    '',
    `- Language code: \`${lang.code}\``,
    `- Canonical page: ${SITE_URL}${languagePath(lang.code)}`,
    `- Stories in this file: ${included.length} of 50`,
    `- Published by: ${publishersOf(lang).join(', ') || 'unfoldingWord'}`,
    lang.updated ? `- Last release: ${lang.updated}` : null,
    `- License: CC BY-SA 4.0 (${LICENSE_URL}). ${ATTRIBUTION}`,
    `- Illustrations: © Sweet Publishing, CC BY-SA 3.0`,
    '',
    `${DEFINITION} This file mirrors the ${name} translation; it is not a translation of the whole Bible.`,
    '',
  ].filter((l) => l !== null);

  const body = included.map((s) => storyMarkdown(lang, s)).join('\n');
  return `${head.join('\n')}\n${body}`;
}

function storyMarkdown(lang: CatalogLanguage, story: Story): string {
  // Most translations already number the title ("1. Uumbaji"), a few do not;
  // prefixing unconditionally gave "## 1. 1. Uumbaji".
  const numbered = /^\s*\d{1,2}\s*[.．、:：)]/.test(story.title);
  const heading = numbered ? story.title.trim() : `${story.num}. ${story.title}`;
  const lines = [`## ${heading}`, '', `${SITE_URL}${storyPath(lang.code, story.num)}`, ''];
  for (const f of story.frames) {
    if (f.image) lines.push(`![](${f.image})`, '');
    if (f.text) lines.push(f.text, '');
  }
  if (story.reference) lines.push(`*${story.reference}*`, '');
  if (story.audio) lines.push(`Audio: ${story.audio}`, '');
  if (story.video) lines.push(`Video: ${story.video}`, '');
  return lines.join('\n');
}

/**
 * /llms.txt — an index, in the format the convention uses: an H1, a
 * blockquote summary, then link lists. Only the marketing pages of the
 * default locale are listed by name (the other 15 locales are one line
 * pointing at the pattern) so the file stays a map rather than a dump.
 */
export async function llmsTxt(): Promise<string> {
  const mirrored = mirroredLanguages();
  const out: string[] = [
    `# ${PRODUCT_NAME}`,
    '',
    `> ${DEFINITION}`,
    '',
    `Canonical site: ${SITE_URL}/. Everything below is free to use, adapt and share under CC BY-SA 4.0 (${LICENSE_URL}); ${ATTRIBUTION}. Illustrations are © Sweet Publishing under CC BY-SA 3.0.`,
    '',
    'Open Bible Stories is a set of 50 illustrated Bible stories, not a translation of the whole Bible. Each language has a hub page, one page per story, and a markdown mirror of its complete text.',
    '',
    '## About',
    '',
  ];
  // Labels come from the English nav so this reads like the site, not like
  // its route table.
  const ui = content('en', 'ui');
  const navLabel = (slug: string) =>
    ui.nav.find((n: { slug: string; label: string }) => n.slug === slug)?.label ??
    (slug === 'home' ? ui.siteTitle : ui.strings?.faqLabel ?? slug);
  for (const slug of localizedSlugs) {
    out.push(`- [${navLabel(slug)}](${SITE_URL}${localePath('en', slug)})`);
  }
  out.push(
    '',
    // Deliberately not a URL pattern: every URL in this file must be one that
    // resolves (check:routes enforces it), and a template is not one.
    `The same pages exist in ${locales.length} interface languages under a locale prefix — ${locales
      .filter((l) => l.code !== 'en')
      .map((l) => `/${l.code}/`)
      .join(', ')} — with English at the site root.`,
    '',
    '## Languages',
    '',
    `${languages.length} published translations. Each line is the language, its hub page, and — where this build has the full text — the markdown mirror of all its stories.`,
    '',
  );
  for (const lang of languages) {
    const name = displayName(lang);
    const english = lang.englishName && lang.englishName !== name ? ` / ${lang.englishName}` : '';
    const hub = `${SITE_URL}${languagePath(lang.code)}`;
    const md = mirrored.includes(lang) ? ` — text: ${SITE_URL}${markdownPath(lang.code)}` : '';
    out.push(`- [${name}${english} (${lang.code})](${hub})${md}`);
  }
  out.push('');
  return out.join('\n');
}
