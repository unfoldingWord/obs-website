// Typed access to the catalog snapshot written by scripts/fetch-catalog.mjs.
// Every public statement about the published languages (count, list, hubs,
// JSON-LD, sitemap) must come from here so the facts cannot drift between
// pages.
//
// src/data/catalog.json is committed as the offline fallback and refreshed
// by the prebuild fetch on every build; the import is tolerant of the file
// being absent so a fresh clone can still type-check, but a production build
// (`fetch-catalog.mjs --required`) refuses to run without data.
import { locales, defaultLocale } from '../i18n/config';

/** Stories in an Open Bible Stories edition. Mirrors STORY_COUNT in
 *  scripts/fetch-catalog.mjs (discover.js carries its own copy). */
export const STORY_COUNT = 50;

export interface CatalogAsset {
  name: string;
  url: string;
  size: number | null;
  /** Release tag the file came from when it is not the entry's own release. */
  tag?: string;
}

export interface CatalogEntry {
  owner: string;
  name: string;
  branch_or_tag_name: string | null;
  title: string | null;
  metadata_type: string | null;
  /** ISO date of the release, when the catalog reports one. */
  released: string | null;
  contentPath: string;
  assets: CatalogAsset[];
}

export interface CatalogStory {
  num: number;
  /** Story title in the language, or null when the file could not be read. */
  title: string | null;
}

export interface CatalogExtract {
  title: string | null;
  text: string;
  reference: string | null;
}

export interface CatalogLanguage {
  /** Language code as used by DCS (IETF-style, e.g. "sw", "es-419", "kmz-x-..."). */
  code: string;
  /** Language name in the language itself (autonym), from the manifest or langnames. */
  title: string;
  /** English name from translationDatabase langnames, when it differs from the autonym. */
  englishName: string | null;
  altNames: string[];
  region: string | null;
  countryCodes: string[];
  direction: 'ltr' | 'rtl';
  /** Self-hosted font pack the text needs; see fontHrefForScript(). The
   *  values are what detectScript() in scripts/fetch-catalog.mjs can return;
   *  `other` means no pack exists for the script and the text renders in
   *  whatever face the visitor's OS has (`npm run check:scripts` fails on
   *  it, so a newly published script gets noticed rather than shipped
   *  unreadable). */
  script:
    | 'latin' | 'cyrillic' | 'arabic' | 'nastaliq' | 'devanagari' | 'bengali'
    | 'gurmukhi' | 'gujarati' | 'oriya' | 'tamil' | 'telugu' | 'kannada'
    | 'malayalam' | 'lao' | 'ethiopic' | 'myanmar' | 'han' | 'other';
  formats: { pdf: boolean; audio: boolean; video: boolean };
  /** Most recent release date across publishing teams (ISO date). */
  updated: string | null;
  entries: CatalogEntry[];
  /** The 50 story titles in the language, or null when none could be read. */
  stories: CatalogStory[] | null;
  /**
   * Story numbers that have full text on disk (src/data/stories/{code}.json)
   * and therefore a page at /l/{code}/story-{n}/. The hub's links, the
   * story routes and sitemap-stories.xml all read this one field, so they
   * cannot disagree about which pages exist. Empty when the language has
   * titles but no readable bodies (a repo that could not be read).
   */
  storyNums?: number[];
  /** Opening of story 1 in the language, for the hub's indexable text sample. */
  extract: CatalogExtract | null;
}

export interface CatalogSnapshot {
  source: string;
  fetchedAt: string | null;
  fetchedDate: string | null;
  languageCount: number;
  languages: CatalogLanguage[];
}

const EMPTY: CatalogSnapshot = {
  source: '',
  fetchedAt: null,
  fetchedDate: null,
  languageCount: 0,
  languages: [],
};

const snapshots = import.meta.glob<{ default: CatalogSnapshot }>('./catalog.json', { eager: true });
export const catalog: CatalogSnapshot = snapshots['./catalog.json']?.default ?? EMPTY;
export const languages: CatalogLanguage[] = catalog.languages;

/** True when the build has real catalog data. False only in offline
 *  development (see the failure policy in fetch-catalog.mjs). */
export const hasCatalog = catalog.languageCount > 0;

/** The single public language count. There is deliberately no hardcoded
 *  placeholder: with no data this is 0 and every page says so, which is
 *  visibly wrong rather than plausibly stale. */
export const languageCount: number = catalog.languageCount;

if (!hasCatalog) {
  console.warn('[catalog] src/data/catalog.json is missing or empty — pages will state 0 languages. Run `npm run fetch:catalog`.');
}

/** Replace the `{count}` placeholder used in localized meta strings. */
export function withCount(text: string): string {
  return text.replace(/\{count\}/g, String(languageCount));
}

/** Canonical public URL path of a language hub. `/l/` keeps content
 *  languages out of the marketing-locale namespace (`/es/`, `/fr/`, …). */
export function languagePath(code: string): string {
  return `/l/${encodeURIComponent(code)}/`;
}

/**
 * Canonical URL of one story: `/l/{code}/story-{n}/`.
 *
 * Deliberately the same shape as the reader's fragment (`#story-{n}`), so the
 * two ways of addressing a story read identically. The number is not padded
 * and there is no title slug: a slug would either be English in every
 * language's URLs, or percent-encoded nonsense for non-Latin scripts, and
 * would move the URL whenever a translation was revised.
 */
export function storyPath(code: string, num: number): string {
  return `${languagePath(code)}story-${num}/`;
}

/** Story numbers that have a page, in order. */
export function pagedStories(lang: CatalogLanguage): CatalogStory[] {
  const nums = new Set(lang.storyNums ?? []);
  return (lang.stories ?? []).filter((s) => nums.has(s.num));
}

/**
 * ISO 639-3 codes that ARE one of our marketing locales under a different
 * spelling. DCS uses both ("fas-x-eastfars" is Persian, "swh" is the
 * Swahili macrolanguage's main member), and a two-letter lookup alone would
 * send both to English.
 */
const LOCALE_ALIASES: Record<string, string> = {
  swh: 'sw', swa: 'sw',
  fas: 'fa', pes: 'fa', prs: 'fa',
  arb: 'ar',
  urd: 'ur',
  hin: 'hi',
  ben: 'bn',
  zho: 'zh', cmn: 'zh',
  ind: 'id',
  vie: 'vi',
  nld: 'nl',
  por: 'pt',
  spa: 'es',
  fra: 'fr',
  rus: 'ru',
  mya: 'my',
};

/**
 * The marketing locale that reads in the same script as a content language.
 *
 * Only 18 of 214 published languages share a primary subtag with one of the
 * 16 marketing locales, so without this the other 196 hubs — every Bhojpuri,
 * Awadhi and Bagheli reader — get their chrome, their FAQ and their format
 * labels in English. A locale in the same script is not the same language,
 * but for these it is a regional language the reader is far more likely to
 * read than English: Hindi for the 88 Devanagari languages of India and
 * Nepal, Bengali for the Bengali-script ones, Russian across the
 * Cyrillic-script languages of Central Asia.
 *
 * Scripts with no marketing locale (Odia, Gujarati, Tamil, Telugu, Kannada,
 * Malayalam, Gurmukhi, Lao, Ethiopic) are deliberately absent — they stay on
 * English until those locales exist. The content text itself (the H1, the
 * extract, the story titles and every story page) is always in the content
 * language whatever this returns.
 */
const SCRIPT_LOCALE: Partial<Record<CatalogLanguage['script'], string>> = {
  devanagari: 'hi',
  bengali: 'bn',
  arabic: 'ar',
  nastaliq: 'ur',
  cyrillic: 'ru',
  myanmar: 'my',
  han: 'zh',
};

/**
 * Within the Arabic script, country beats script: a reader of an Iranian or
 * Afghan language reads Persian, and one in Pakistan reads Urdu, sooner than
 * Modern Standard Arabic.
 */
const ARABIC_COUNTRY_LOCALE: Record<string, string> = { IR: 'fa', AF: 'fa', TJ: 'fa', PK: 'ur' };

/**
 * The marketing locale a content language IS, or null when it is only
 * related to one. "es-419" → es, "swh" → sw, "pt-br" → pt; a script subtag
 * the locale does not share ("zh-hant", "ur-deva") is not the same language
 * for this purpose and returns null.
 *
 * Two things read this: the hub chrome (step 1 of hubLocaleFor), and the
 * story-level hreflang clusters in src/lib/sitemap.ts, which are limited to
 * exactly these languages — the ones the site itself is published in.
 */
export function siteLocaleOf(code: string): string | null {
  const parts = code.toLowerCase().split(/[-_]/);
  const primary = LOCALE_ALIASES[parts[0]] ?? parts[0];
  const locale = locales.find((l) => l.code === primary);
  if (!locale) return null;
  const subtag = parts.slice(1).find((p) => /^[a-z]{4}$/.test(p));
  if (subtag && !locale.tag.toLowerCase().split('-').includes(subtag)) return null;
  return locale.code;
}

/**
 * The marketing UI locale whose chrome (nav, footer, hub labels, FAQ) best
 * fits a content language:
 *
 * 1. the same language — the same primary subtag or an ISO 639-3 alias for
 *    it ("es-419" → es, "pt-br" → pt, "swh" → sw, "fas-x-eastfars" → fa);
 * 2. failing that, a locale in the same script, refined by country for the
 *    Arabic script (see SCRIPT_LOCALE / ARABIC_COUNTRY_LOCALE);
 * 3. failing that, English.
 *
 * A script subtag the locale does not share ("zh-hant" vs zh-Hans,
 * "ur-deva" vs ur) drops out of step 1 — chrome must not be in a script the
 * page's own text is not written in — and is answered by step 2, which reads
 * the script of the text itself: "ur-deva" gets Hindi, not Urdu in a script
 * its readers did not ask for.
 */
export function hubLocaleFor(lang: Pick<CatalogLanguage, 'code' | 'script' | 'countryCodes'>): string {
  const exact = siteLocaleOf(lang.code);
  if (exact) return exact;

  if (lang.script === 'arabic' || lang.script === 'nastaliq') {
    for (const cc of lang.countryCodes ?? []) {
      const byCountry = ARABIC_COUNTRY_LOCALE[cc.toUpperCase()];
      if (byCountry) return byCountry;
    }
  }
  return SCRIPT_LOCALE[lang.script] ?? defaultLocale;
}

/** Name to show as the hub's H1: the autonym, or the English name when the
 *  autonym is unknown (the code stands in for the title then). */
export function displayName(lang: CatalogLanguage): string {
  return lang.title === lang.code && lang.englishName ? lang.englishName : lang.title;
}

/** The illustration for a story's first frame. The OBS art is language-
 *  independent; this is the same host and size the reader loads from. */
export function storyImage(num: number): string {
  return `https://cdn.door43.org/obs/jpg/360px/obs-en-${String(num).padStart(2, '0')}-01.jpg`;
}

/** Stories that were actually read from the repo (a title exists). The hub
 *  and its JSON-LD list exactly these — never a padded list of 50. */
export function readableStories(lang: CatalogLanguage): CatalogStory[] {
  return (lang.stories ?? []).filter((s) => s.title);
}

/** Distinct publishing teams, in catalog order. */
export function publishersOf(lang: CatalogLanguage): string[] {
  return Array.from(new Set(lang.entries.map((e) => e.owner).filter(Boolean)));
}

/** The YouTube link for a language, if any release carries one. */
export function youtubeOf(lang: CatalogLanguage): CatalogAsset | undefined {
  return classifyAssets(lang).video.find((a) => /youtu\.?be/i.test(a.url));
}

/** The one PDF to offer first: from the most recently released entry that
 *  has one. Other teams' PDFs are listed under their publisher. */
export function primaryPdf(lang: CatalogLanguage): (CatalogAsset & { owner: string }) | undefined {
  const byDate = [...lang.entries].sort((a, b) => (b.released ?? '').localeCompare(a.released ?? ''));
  for (const e of byDate) {
    const pdf = e.assets.find((a) => /\.pdf$/i.test(a.name) || /\.pdf$/i.test(a.url));
    if (pdf) return { ...pdf, owner: e.owner };
  }
  return undefined;
}

/** The full-audio zip for a language, if a release carries one. */
export function audioZipOf(lang: CatalogLanguage): CatalogAsset | undefined {
  return classifyAssets(lang).audio.find((a) => /\.zip$/i.test(a.name));
}

/** Human file size for download labels, or null when unknown. */
export function formatSize(n: number | null | undefined): string | null {
  if (!n) return null;
  const mb = n / 1048576;
  return `${mb.toFixed(mb > 10 ? 0 : 1)} MB`;
}

/** Every script we ship a self-hosted font pack for — the keys of PACKS in
 *  scripts/build-font-css.mjs. `latin` is served by the committed variable
 *  faces and needs no pack; `other` has none, which is what
 *  `npm run check:scripts` looks for. */
export const FONT_PACKS = [
  'cyrillic', 'arabic', 'nastaliq', 'devanagari', 'bengali', 'gurmukhi',
  'gujarati', 'oriya', 'tamil', 'telugu', 'kannada', 'malayalam', 'lao',
  'ethiopic', 'myanmar', 'han',
] as const;

/** Stylesheet for a detected script, or null when the Latin faces suffice. */
export function fontHrefForScript(script: CatalogLanguage['script']): string | null {
  return (FONT_PACKS as readonly string[]).includes(script) ? `/assets/fonts/${script}.css` : null;
}

/** Downloadable assets of a language, classified for the hub's format list.
 *  Deduplicated by URL (two teams can publish the same file). */
export function classifyAssets(lang: CatalogLanguage) {
  const seen = new Set<string>();
  const all = lang.entries
    .flatMap((e) => e.assets.map((a) => ({ ...a, owner: e.owner })))
    .filter((a) => (seen.has(a.url) ? false : (seen.add(a.url), true)));
  const pick = (re: RegExp) => all.filter((a) => re.test(a.name) || re.test(a.url));
  return {
    pdf: pick(/\.pdf$/i),
    epub: pick(/\.epub$/i),
    docx: pick(/\.docx$/i),
    audio: pick(/\.mp3$|audio|mp3/i).filter((a) => !/\.mp4$|video/i.test(a.name)),
    video: pick(/\.(mp4|3gp)$|video|youtu\.?be/i),
  };
}
