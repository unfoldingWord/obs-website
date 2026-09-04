// Typed access to the catalog snapshot written by scripts/fetch-catalog.mjs.
// Every public statement about the published languages (count, list,
// JSON-LD) must come from here so the facts cannot drift between pages.
//
// src/data/catalog.json is committed as the offline fallback and refreshed
// by the prebuild fetch on every build; the import is tolerant of the file
// being absent so a fresh clone can still type-check, but a production build
// (`fetch-catalog.mjs --required`) refuses to run without data.
import { localePath } from '../i18n/config';

export interface CatalogEntry {
  owner: string;
  name: string;
  branch_or_tag_name: string | null;
  title: string | null;
  metadata_type: string | null;
}

export interface CatalogLanguage {
  /** Language code as used by DCS (IETF-style, e.g. "sw", "es-419", "kmz-x-..."). */
  code: string;
  /** Language name from the resource manifest, usually the autonym. */
  title: string;
  direction: 'ltr' | 'rtl';
  formats: { pdf: boolean; audio: boolean; video: boolean };
  entries: CatalogEntry[];
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

/**
 * Interim link for a language until /l/{code}/ hubs exist (#6): the Discover
 * deep link in the current locale, which discover.js opens on load and which
 * scrolls to the row (each <li> carries id={code}) without JS. This is a
 * fragment of the Discover page, NOT a distinct URL — never advertise it as a
 * canonical translation URL in JSON-LD or sitemaps.
 */
export function languagePath(code: string, locale: string): string {
  return `${localePath(locale, 'discover')}#${encodeURIComponent(code)}`;
}
