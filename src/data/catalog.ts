// Typed access to the build-time catalog snapshot written by
// scripts/fetch-catalog.mjs. Every public statement about the published
// languages (count, list, JSON-LD) must come from here so the facts cannot
// drift between pages.
import snapshot from './catalog.json';

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

export const catalog = snapshot as CatalogSnapshot;
export const languages: CatalogLanguage[] = catalog.languages;

/** True when the build has real catalog data (an empty snapshot only happens
 *  in offline development — see the failure policy in fetch-catalog.mjs). */
export const hasCatalog = catalog.languageCount > 0;

/** Last known published-language count, used ONLY when the snapshot is empty
 *  (offline dev). Production builds refuse to run without catalog data. */
const OFFLINE_PLACEHOLDER_COUNT = 214;

/** The single public language count. */
export const languageCount: number = hasCatalog ? catalog.languageCount : OFFLINE_PLACEHOLDER_COUNT;

/** Replace the `{count}` placeholder used in localized meta strings. */
export function withCount(text: string): string {
  return text.replace(/\{count\}/g, String(languageCount));
}

/** Interim public URL for a language until /l/{code}/ hubs exist: the
 *  Discover deep link that discover.js opens on load. Kept in one place so
 *  the list, JSON-LD and any future sitemap agree. */
export function languagePath(code: string): string {
  return `/discover/#${encodeURIComponent(code)}`;
}
