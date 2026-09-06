// JSON-LD builders. One graph per page: Base.astro emits a single
// <script type="application/ld+json"> containing Organization + WebSite plus
// whatever page-specific nodes a page passes in via the `jsonLd` prop.
//
// Facts here are the standardized public entity facts (see README →
// "Catalog data and public facts"): product name, one-sentence definition,
// license.
import { languagePath, readerPath, classifyAssets, hubLocaleFor, readableStories, publishersOf, type CatalogLanguage } from '../data/catalog';

export const SITE_URL = 'https://openbiblestories.org';
export const PRODUCT_NAME = 'unfoldingWord Open Bible Stories';
export const LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/';
export const PUBLISHER_ID = 'https://unfoldingword.org/#organization';
export const WEBSITE_ID = `${SITE_URL}/#website`;
export const WORK_ID = `${SITE_URL}/#work`;

/** One-sentence English definition, kept identical wherever it appears. */
export const DEFINITION =
  'unfoldingWord Open Bible Stories is a collection of 50 illustrated Bible stories, from Creation to Revelation, that churches and translation teams read, listen to, translate and share freely under the Creative Commons Attribution-ShareAlike 4.0 license.';

// Only links that appear on the site today. Add YouTube / Wikidata / app
// store pages here once the canonical URLs are confirmed — a wrong sameAs
// is worse than none.
const ORGANIZATION_SAME_AS = ['https://door43.org/'];
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.unfoldingword.obsapp';

export function organizationNode() {
  return {
    '@type': 'Organization',
    '@id': PUBLISHER_ID,
    name: 'unfoldingWord',
    url: 'https://unfoldingword.org/',
    logo: {
      '@type': 'ImageObject',
      url: `${SITE_URL}/assets/img/uw-logo-color.png`,
    },
    sameAs: ORGANIZATION_SAME_AS,
  };
}

/** Marketing-page nodes shared by every route: Organization + WebSite with a
 *  SearchAction that lands on Discover with the query prefilled (?q=). */
export function websiteNode(inLanguage: string) {
  return {
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    url: `${SITE_URL}/`,
    name: 'Open Bible Stories',
    alternateName: PRODUCT_NAME,
    inLanguage,
    publisher: { '@id': PUBLISHER_ID },
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/discover/?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

/** The work itself — the English source edition every translation derives
 *  from. Emitted on the homepage and Discover. The story count belongs on
 *  an ItemList of stories (hubs carry one), and the translations list is
 *  its own ItemList on Discover — neither is stubbed here. */
export function workNode() {
  return {
    '@type': 'CreativeWork',
    '@id': WORK_ID,
    name: PRODUCT_NAME,
    alternateName: 'Open Bible Stories',
    description: DEFINITION,
    url: `${SITE_URL}/`,
    inLanguage: 'en',
    license: LICENSE_URL,
    isAccessibleForFree: true,
    isFamilyFriendly: true,
    genre: 'Bible stories',
    publisher: { '@id': PUBLISHER_ID },
    copyrightHolder: { '@id': PUBLISHER_ID },
    image: `${SITE_URL}/assets/img/story-boat.jpg`,
    // Media objects are emitted only on story pages where a file exists
    // (Phase 3) — never as empty placeholders here.
  };
}

export function mobileAppNode() {
  return {
    '@type': 'MobileApplication',
    name: 'Open Bible Stories app',
    operatingSystem: 'Android',
    applicationCategory: 'ReferenceApplication',
    isAccessibleForFree: true,
    installUrl: PLAY_STORE_URL,
    publisher: { '@id': PUBLISHER_ID },
  };
}

export function hubId(code: string): string {
  return `${SITE_URL}${languagePath(code)}#work`;
}

/** The one name a translation node carries everywhere it appears. */
export function translationName(lang: CatalogLanguage): string {
  return lang.englishName ? `${PRODUCT_NAME} (${lang.title} / ${lang.englishName})` : `${PRODUCT_NAME} (${lang.title})`;
}

/** One CreativeWork per published translation, pointing at its hub. */
export function translationNode(lang: CatalogLanguage, extra: Record<string, unknown> = {}) {
  return {
    '@type': 'CreativeWork',
    '@id': hubId(lang.code),
    name: translationName(lang),
    url: `${SITE_URL}${languagePath(lang.code)}`,
    inLanguage: lang.code,
    license: LICENSE_URL,
    isAccessibleForFree: true,
    translationOfWork: { '@id': WORK_ID },
    ...extra,
  };
}

/** ItemList of all published translations. Emitted once, on the default-
 *  locale Discover page (the catalog page), not on all 16 locale copies. */
export function translationListNode(languages: CatalogLanguage[]) {
  return {
    '@type': 'ItemList',
    '@id': `${SITE_URL}/discover/#translations`,
    name: `${PRODUCT_NAME} — published translations`,
    numberOfItems: languages.length,
    itemListOrder: 'https://schema.org/ItemListUnordered',
    itemListElement: languages.map((lang, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: { '@id': hubId(lang.code), '@type': 'CreativeWork', name: translationName(lang), url: `${SITE_URL}${languagePath(lang.code)}`, inLanguage: lang.code },
    })),
  };
}

/**
 * Nodes for a language hub: the translation as a CreativeWork (with
 * publisher, alternate names, dateModified, and download encodings that
 * actually exist) plus an ItemList of the stories that were actually read
 * from the repo, linking into the reader. No VideoObject: Google requires
 * name/thumbnailUrl/uploadDate for it, which the catalog does not have —
 * media objects come with story pages (Phase 3, #16). Story pages will give
 * each story its own @id; until then the reader deep link is the story URL.
 */
export function hubNodes(lang: CatalogLanguage) {
  const assets = classifyAssets(lang);
  const uiLocale = hubLocaleFor(lang.code);
  const encodings = [
    ...assets.pdf.map((a) => ({ '@type': 'MediaObject', encodingFormat: 'application/pdf', contentUrl: a.url, name: a.name })),
    ...assets.epub.map((a) => ({ '@type': 'MediaObject', encodingFormat: 'application/epub+zip', contentUrl: a.url, name: a.name })),
  ];
  const publishers = publishersOf(lang);
  const alternateName = [lang.englishName, ...lang.altNames].filter(Boolean);
  const extra: Record<string, unknown> = {
    publisher: publishers.length === 1 && publishers[0] === 'unfoldingWord'
      ? { '@id': PUBLISHER_ID }
      : publishers.map((p) => ({ '@type': 'Organization', name: p, url: `https://git.door43.org/${p}` })),
    sameAs: lang.entries.map((e) => `https://git.door43.org/${e.owner}/${e.name}`),
    version: lang.entries[0]?.branch_or_tag_name ?? undefined,
    dateModified: lang.updated ?? undefined,
  };
  if (alternateName.length) extra.alternateName = alternateName;
  if (lang.extract?.text) extra.abstract = lang.extract.text;
  if (encodings.length) extra.encoding = encodings;
  const work = translationNode(lang, extra);

  const stories = readableStories(lang);
  if (!stories.length) return [work];
  const list = {
    '@type': 'ItemList',
    '@id': `${SITE_URL}${languagePath(lang.code)}#stories`,
    name: `${lang.title} — ${stories.length} ${stories.length === 1 ? 'story' : 'stories'}`,
    numberOfItems: stories.length,
    itemListOrder: 'https://schema.org/ItemListOrderAscending',
    itemListElement: stories.map((s, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: s.title,
      url: `${SITE_URL}${readerPath(lang.code, s.num, uiLocale)}`,
    })),
  };
  return [work, list];
}

/** Serialize a graph safely for an inline <script> (no `</script>` escape). */
export function serializeGraph(nodes: unknown[]): string {
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes }).replace(/</g, '\\u003c');
}
