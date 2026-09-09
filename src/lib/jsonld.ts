// JSON-LD builders. One graph per page: Base.astro emits a single
// <script type="application/ld+json"> containing Organization + WebSite plus
// whatever page-specific nodes a page passes in via the `jsonLd` prop.
//
// Facts here are the standardized public entity facts (see README →
// "Catalog data and public facts"): product name, one-sentence definition,
// license.
import { languagePath, storyPath, classifyAssets, hubLocaleFor, readableStories, pagedStories, publishersOf, storyImage, type CatalogLanguage } from '../data/catalog';
import { type Story } from '../data/stories';
import { localePath } from '../i18n/config';

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

/**
 * FAQPage for one locale's /faq/ page (#17).
 *
 * Emitted only on the marketing FAQ pages, where the visible H2/answer text
 * and the structured data are the same words — the requirement Google states
 * for FAQ rich results. The hubs' own FAQ block is deliberately visible-only:
 * 214 near-identical FAQPage nodes would be boilerplate.
 *
 * `answers` arrive as HTML (the copy carries links); `acceptedAnswer.text`
 * may contain HTML, so it is passed through as written.
 */
export function faqPageNode(locale: string, questions: { q: string; a: string }[]) {
  return {
    '@type': 'FAQPage',
    '@id': `${SITE_URL}${localePath(locale, 'faq')}#faq`,
    inLanguage: locale,
    isPartOf: { '@id': WEBSITE_ID },
    publisher: { '@id': PUBLISHER_ID },
    mainEntity: questions.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
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
 * from the repo, linking into the reader.
 *
 * Downloadable files are `encoding` MediaObjects — PDF, EPUB, and the
 * full-audio zip where a release publishes one. Still no VideoObject here
 * (#16): what most languages publish is a YouTube *playlist*, which is not
 * one video and has neither a duration nor an upload date; it goes in
 * `sameAs` as another canonical home for the language. Per-story recordings
 * are real media and carry Audio/VideoObject on the story pages, where the
 * transcript sits beside them.
 */
export function hubNodes(lang: CatalogLanguage, builtStoryNums: Set<number>) {
  const assets = classifyAssets(lang);
  const uiLocale = hubLocaleFor(lang);
  const encodings = [
    ...assets.pdf.map((a) => ({ '@type': 'MediaObject', encodingFormat: 'application/pdf', contentUrl: a.url, name: a.name })),
    ...assets.epub.map((a) => ({ '@type': 'MediaObject', encodingFormat: 'application/epub+zip', contentUrl: a.url, name: a.name })),
    ...assets.audio
      .filter((a) => /\.zip$/i.test(a.name))
      .map((a) => ({
        '@type': 'MediaObject',
        encodingFormat: 'application/zip',
        contentUrl: a.url,
        name: a.name,
        inLanguage: lang.code,
        ...(a.size ? { contentSize: String(a.size) } : {}),
      })),
  ];
  const publishers = publishersOf(lang);
  const alternateName = [lang.englishName, ...lang.altNames].filter(Boolean);
  const extra: Record<string, unknown> = {
    publisher: publishers.length === 1 && publishers[0] === 'unfoldingWord'
      ? { '@id': PUBLISHER_ID }
      : publishers.map((p) => ({ '@type': 'Organization', name: p, url: `https://git.door43.org/${p}` })),
    // The repos the translation lives in, plus the language's YouTube
    // playlist where one exists (#16/#18: the other places a searcher or a
    // model already meets this translation, tied to the canonical hub).
    sameAs: [
      ...lang.entries.map((e) => `https://git.door43.org/${e.owner}/${e.name}`),
      ...assets.video.filter((a) => /youtu\.?be/i.test(a.url)).map((a) => a.url),
    ],
    version: lang.entries[0]?.branch_or_tag_name ?? undefined,
    dateModified: lang.updated ?? undefined,
    image: storyImage(1),
  };
  if (alternateName.length) extra.alternateName = alternateName;
  if (lang.extract?.text) extra.abstract = lang.extract.text;
  if (encodings.length) extra.encoding = encodings;
  const work = translationNode(lang, extra);

  // Only stories that actually have a page in this build — the ItemList must
  // not advertise URLs that do not exist. The caller reads the built numbers
  // from the language's story file (storyNums alone can overstate them).
  const stories = pagedStories(lang).filter((s) => builtStoryNums.has(s.num));
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
      url: `${SITE_URL}${storyPath(lang.code, s.num)}`,
    })),
  };
  return [work, list];
}

/**
 * One story page: the story as a part of its language's translation, with the
 * full text so an answer engine can quote it, and Audio/VideoObject only
 * when a real recording exists — never an empty placeholder.
 *
 * The media objects carry `transcript` (#16): the page's visible text IS the
 * transcript of the recording, in the same language, which is what lets a
 * search engine index what the audio or video says. `uploadDate` and
 * `thumbnailUrl` — required by Google for a VideoObject — come from the
 * release date and the story's first illustration, so a VideoObject is
 * emitted only when both exist.
 */
export function storyNodes(lang: CatalogLanguage, story: Story) {
  const url = `${SITE_URL}${storyPath(lang.code, story.num)}`;
  const node: Record<string, unknown> = {
    '@type': 'CreativeWork',
    '@id': `${url}#story`,
    name: story.title,
    url,
    position: story.num,
    inLanguage: lang.code,
    license: LICENSE_URL,
    isAccessibleForFree: true,
    isPartOf: { '@id': hubId(lang.code) },
    publisher: { '@id': PUBLISHER_ID },
    text: story.frames.map((f) => f.text).join(' '),
  };
  const image = story.frames.find((f) => f.image)?.image;
  if (image) node.image = image;
  if (story.reference) node.citation = story.reference;
  const transcript = node.text as string;
  if (story.audio) {
    node.audio = {
      '@type': 'AudioObject',
      contentUrl: story.audio,
      encodingFormat: 'audio/mpeg',
      inLanguage: lang.code,
      name: story.title,
      transcript,
      license: LICENSE_URL,
      isAccessibleForFree: true,
    };
  }
  // `uploadDate` is the publish date of the release THIS FILE came from
  // (story.videoDate), never the language's newest release: a video is
  // published once and the text revised several times afterwards, so
  // lang.updated made every later text release rewrite the apparent upload
  // date of an unchanged video. Google requires the field, so a story file
  // that predates it (or a release with no date) gets no VideoObject rather
  // than a wrong one.
  if (story.video && image && story.videoDate) {
    node.video = {
      '@type': 'VideoObject',
      name: story.title,
      description: story.title,
      contentUrl: story.video,
      encodingFormat: /\.3gp$/i.test(story.video) ? 'video/3gpp' : 'video/mp4',
      thumbnailUrl: image,
      uploadDate: story.videoDate,
      inLanguage: lang.code,
      transcript,
      license: LICENSE_URL,
      isAccessibleForFree: true,
      publisher: { '@id': PUBLISHER_ID },
    };
  }
  return [node];
}

/** Serialize a graph safely for an inline <script> (no `</script>` escape). */
export function serializeGraph(nodes: unknown[]): string {
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': nodes }).replace(/</g, '\\u003c');
}
