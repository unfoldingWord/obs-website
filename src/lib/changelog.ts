// The public changelog of newly published and updated languages (#19).
//
// Answer engines and search both favour sources that visibly move, and a
// partner deciding whether to link wants to see that the site is alive.
// `lastmod` in the sitemaps and the per-build catalog refresh already carry
// that signal to machines; this is the human-readable, dated version — one
// line per language, generated from the same snapshot as everything else, so
// it cannot say a language exists that Discover does not list.
//
// Two kinds of line, and the distinction is the whole point:
//   - a NEW language: dated by the earliest release of any of its publishing
//     teams (`firstReleased`, read from the Door43 release history);
//   - an UPDATED translation: a later release of a language that was already
//     published, dated by `updated` (the most recent release).
// Where the release history could not be read, the first-release date is
// unknown, and the language is listed as "date not known" rather than being
// given its latest release date as if it were new. The page says how many
// are in that state, so the list can never quietly present a tenth revision
// as a first publication.
import { catalog, languages, languagePath, displayName, firstPublished, type CatalogLanguage } from '../data/catalog';
import { SITE_URL } from './jsonld';

export const CHANGELOG_PATH = '/changelog/';
export const CHANGELOG_FEED_PATH = '/changelog.xml';

/** How far back the "updated" list reaches. Older revisions are visible on
 *  each hub (version and release date per publisher). */
export const UPDATED_WINDOW_DAYS = 365;

export interface ChangelogEvent {
  kind: 'new' | 'updated';
  /** ISO date of the event. */
  date: string;
  code: string;
  name: string;
  englishName: string | null;
  path: string;
  /** Teams that released on that date (an update) or first published (new). */
  publishers: string[];
  /** Version tag of the release the event describes, if the entry has one. */
  version: string | null;
}

export interface Changelog {
  /** Date the snapshot was taken; the list is "as of" this day. */
  asOf: string | null;
  languageCount: number;
  /** Newly published languages, newest first. */
  added: ChangelogEvent[];
  /** Translations updated within the window, newest first. */
  updated: ChangelogEvent[];
  /** Languages whose first-release date could not be read from Door43. */
  undated: CatalogLanguage[];
}

const byDateDesc = (a: ChangelogEvent, b: ChangelogEvent) =>
  b.date.localeCompare(a.date) || a.name.localeCompare(b.name, 'en');

function versionOf(tag: string | null): string | null {
  return tag ? tag.replace(/^v/i, '') : null;
}

/** The entries that published on a given date. */
function entriesOn(lang: CatalogLanguage, date: string, field: 'released' | 'firstReleased') {
  return lang.entries.filter((e) => (e[field] ?? null) === date);
}

function eventFor(lang: CatalogLanguage, kind: ChangelogEvent['kind'], date: string): ChangelogEvent {
  const entries = entriesOn(lang, date, kind === 'new' ? 'firstReleased' : 'released');
  return {
    kind,
    date,
    code: lang.code,
    name: displayName(lang),
    englishName: lang.englishName && lang.englishName !== displayName(lang) ? lang.englishName : null,
    path: languagePath(lang.code),
    publishers: Array.from(new Set(entries.map((e) => e.owner).filter(Boolean))),
    // A first publication is described by the version that shipped that
    // day only when the entry's current release IS that release; otherwise
    // the current version would be attached to an older date.
    version:
      kind === 'updated'
        ? versionOf(entries[0]?.branch_or_tag_name ?? null)
        : versionOf(entries.find((e) => e.released === date)?.branch_or_tag_name ?? null),
  };
}

/** Days between two ISO dates (b − a). */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

export function buildChangelog(langs: CatalogLanguage[] = languages, asOf: string | null = catalog.fetchedDate): Changelog {
  const added: ChangelogEvent[] = [];
  const updated: ChangelogEvent[] = [];
  const undated: CatalogLanguage[] = [];
  for (const lang of langs) {
    const first = firstPublished(lang);
    if (first) added.push(eventFor(lang, 'new', first));
    else undated.push(lang);
    // An update is a release after the first one. With no first date there
    // is no way to tell, and the language stays in `undated` only.
    if (first && lang.updated && lang.updated > first) {
      if (!asOf || daysBetween(lang.updated, asOf) <= UPDATED_WINDOW_DAYS) {
        updated.push(eventFor(lang, 'updated', lang.updated));
      }
    }
  }
  added.sort(byDateDesc);
  updated.sort(byDateDesc);
  undated.sort((a, b) => displayName(a).localeCompare(displayName(b), 'en'));
  return { asOf, languageCount: langs.length, added, updated, undated };
}

/** "August 2026" for grouping headings. English: the page is English-only. */
export function monthLabel(isoDate: string): string {
  const [y, m] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Group events by calendar month, preserving their order. */
export function byMonth(events: ChangelogEvent[]): { month: string; events: ChangelogEvent[] }[] {
  const groups: { month: string; events: ChangelogEvent[] }[] = [];
  for (const ev of events) {
    const key = ev.date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.month === key) last.events.push(ev);
    else groups.push({ month: key, events: [ev] });
  }
  return groups;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Feed-entry title, also used as the visible line's sense. */
export function eventTitle(ev: ChangelogEvent): string {
  const who = ev.englishName ? `${ev.name} (${ev.englishName})` : ev.name;
  return ev.kind === 'new'
    ? `New language: Open Bible Stories in ${who}`
    : `Updated: Open Bible Stories in ${who}${ev.version ? ` v${ev.version}` : ''}`;
}

/**
 * An Atom feed of the same events, newest first, capped so it stays a feed
 * and not an archive. Bing Webmaster Tools accepts a feed as a sitemap, and
 * a partner can subscribe to it instead of re-reading the page.
 */
export function changelogFeed(log: Changelog = buildChangelog(), limit = 100): string {
  const events = [...log.added, ...log.updated].sort(byDateDesc).slice(0, limit);
  const latest = events[0]?.date ?? log.asOf;
  const stamp = (d: string | null) => `${d ?? '1970-01-01'}T00:00:00Z`;
  const items = events
    .map((ev) => {
      const url = `${SITE_URL}${ev.path}`;
      const teams = ev.publishers.length ? ` Published by ${ev.publishers.join(', ')}.` : '';
      const summary =
        ev.kind === 'new'
          ? `Open Bible Stories was first published in ${ev.name} (${ev.code}) on ${ev.date}.${teams}`
          : `The ${ev.name} (${ev.code}) translation of Open Bible Stories was updated on ${ev.date}${ev.version ? ` (v${ev.version})` : ''}.${teams}`;
      return [
        '  <entry>',
        `    <id>${esc(url)}#${ev.kind}-${ev.date}</id>`,
        `    <title>${esc(eventTitle(ev))}</title>`,
        `    <link rel="alternate" type="text/html" href="${esc(url)}"/>`,
        `    <updated>${stamp(ev.date)}</updated>`,
        `    <published>${stamp(ev.date)}</published>`,
        `    <category term="${ev.kind}"/>`,
        `    <summary>${esc(summary)}</summary>`,
        '  </entry>',
      ].join('\n');
    })
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <id>${SITE_URL}${CHANGELOG_FEED_PATH}</id>`,
    '  <title>Open Bible Stories — newly published and updated languages</title>',
    `  <subtitle>${esc(`${log.languageCount} languages have a published translation. Generated from the Door43 catalog on every build.`)}</subtitle>`,
    `  <link rel="self" type="application/atom+xml" href="${SITE_URL}${CHANGELOG_FEED_PATH}"/>`,
    `  <link rel="alternate" type="text/html" href="${SITE_URL}${CHANGELOG_PATH}"/>`,
    `  <updated>${stamp(latest)}</updated>`,
    '  <author><name>unfoldingWord</name><uri>https://unfoldingword.org/</uri></author>',
    '  <rights>CC BY-SA 4.0</rights>',
    items,
    '</feed>',
    '',
  ].join('\n');
}
