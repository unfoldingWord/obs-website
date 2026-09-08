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
import { STORY_SLUGS, storySlug } from './story-slugs';
export { STORY_SLUGS, storySlug };

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
  /** Self-hosted font pack the text needs; see fontHrefForScript(). */
  script: 'latin' | 'cyrillic' | 'arabic' | 'nastaliq' | 'devanagari' | 'bengali' | 'myanmar' | 'han' | 'other';
  formats: { pdf: boolean; audio: boolean; video: boolean };
  /** Most recent release date across publishing teams (ISO date). */
  updated: string | null;
  entries: CatalogEntry[];
  /** The 50 story titles in the language, or null when none could be read. */
  stories: CatalogStory[] | null;
  /**
   * Story numbers that have full text on disk (src/data/stories/{code}.json)
   * and therefore a page at /l/{code}/{NN}-{slug}/. The hub's links, the
   * story routes and sitemap-stories.xml all read this one field, so they
   * cannot disagree about which pages exist. Empty when the language has
   * titles but no readable bodies (legacy translationStudio repos).
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
 * Canonical URL of one story: /l/{code}/{NN}-{slug}/.
 *
 * The slug is the canonical English one for that story number, identical in
 * every language, so URLs stay stable and ASCII — slugifying local titles
 * would percent-encode badly for non-Latin scripts and would move the URL
 * whenever a translation is revised.
 */
export function storyPath(code: string, num: number): string {
  return `${languagePath(code)}${String(num).padStart(2, '0')}-${storySlug(num)}/`;
}

/** Story numbers that have a page, in order. */
export function pagedStories(lang: CatalogLanguage): CatalogStory[] {
  const nums = new Set(lang.storyNums ?? []);
  return (lang.stories ?? []).filter((s) => nums.has(s.num));
}

/**
 * The marketing UI locale whose chrome (nav, footer, hub labels) best fits a
 * content language: the same primary subtag when we have that locale
 * ("es-419" → es, "pt-br" → pt, "sw" → sw), otherwise English. A script
 * subtag the locale does not share ("zh-hant" vs zh-Hans, "ur-deva" vs ur)
 * falls back to English rather than serving chrome in the wrong script.
 */
export function hubLocaleFor(code: string): string {
  const parts = code.toLowerCase().split(/[-_]/);
  const locale = locales.find((l) => l.code === parts[0]);
  if (!locale) return defaultLocale;
  const script = parts.slice(1).find((p) => /^[a-z]{4}$/.test(p));
  if (script && !locale.tag.toLowerCase().split('-').includes(script)) return defaultLocale;
  return locale.code;
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

/** Stylesheet for a detected script, or null when the Latin faces suffice. */
export function fontHrefForScript(script: CatalogLanguage['script']): string | null {
  const packs = new Set(['cyrillic', 'arabic', 'nastaliq', 'devanagari', 'bengali', 'myanmar', 'han']);
  return packs.has(script) ? `/assets/fonts/${script}.css` : null;
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
