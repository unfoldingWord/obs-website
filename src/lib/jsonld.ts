// JSON-LD builders. One graph per page: Base.astro emits a single
// <script type="application/ld+json"> containing Organization + WebSite plus
// whatever page-specific nodes a page passes in via the `jsonLd` prop.
//
// Facts here are the standardized public entity facts (see README →
// "Public facts"): product name, one-sentence definition, license.
import { languageCount, languagePath, type CatalogLanguage } from '../data/catalog';

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
 *  from. Emitted on the homepage and Discover. */
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
    numberOfItems: 50,
    publisher: { '@id': PUBLISHER_ID },
    copyrightHolder: { '@id': PUBLISHER_ID },
    image: `${SITE_URL}/assets/img/story-boat.jpg`,
    // Number of languages the work is published in; sourced from the DCS
    // catalog at build time (see src/data/catalog.ts).
    workTranslation: { '@type': 'ItemList', numberOfItems: languageCount },
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

/** One CreativeWork per published translation — reusable by the future
 *  /l/{code}/ hub template, which should add its own @id and ItemList of
 *  the 50 stories. */
export function translationNode(lang: CatalogLanguage, dateModified?: string | null) {
  const node: Record<string, unknown> = {
    '@type': 'CreativeWork',
    name: `${PRODUCT_NAME} (${lang.title})`,
    url: `${SITE_URL}${languagePath(lang.code)}`,
    inLanguage: lang.code,
    license: LICENSE_URL,
    isAccessibleForFree: true,
    translationOfWork: { '@id': WORK_ID },
  };
  if (dateModified) node.dateModified = dateModified;
  return node;
}

/** ItemList of all published translations, for Discover. */
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
      item: translationNode(lang),
    })),
  };
}

/** Serialize a graph safely for an inline <script> (no `</script>` escape). */
export function serializeGraph(nodes: unknown[]): string {
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes }).replace(/</g, '\\u003c');
}
