// Build-time snapshot of the published Open Bible Stories catalog.
//
// Runs before `astro build` / `astro dev` (see package.json) and writes
// src/data/catalog.json, which is the ONE source for every public fact about
// "how many languages" and "which languages":
//   - the language count on the homepage and Why OBS page
//   - the prerendered language list on /discover/ (crawlable without JS)
//   - meta descriptions that mention the count
//   - JSON-LD (ItemList of translations)
//
// The number is therefore defined as: the count of distinct language codes
// with at least one production-stage "Open Bible Stories" entry in the
// Door43 Content Service (DCS) catalog, excluding the Theological Formation
// edition — exactly the set Discover shows. Changing the catalog changes the
// number on the next build. Nothing at runtime fetches a different count.
//
// The same endpoint and filters as public/assets/js/discover.js: no `limit`
// (omitting it returns every matching entry), no `metadataType` filter (16
// languages only have the older translationStudio format). If the response
// is nevertheless shorter than X-Total-Count, the remainder is fetched page
// by page; a snapshot that is still short is an error, never written.
//
// Failure policy: a deploy that ships an empty or partial catalog would
// publish a wrong count and delist translations, so:
//   - the snapshot on disk (src/data/catalog.json, committed as the offline
//     fallback) is only overwritten by a complete, successful fetch;
//   - on failure the existing snapshot is kept, with a warning;
//   - a production build (`--required`) fails only when the fetch fails AND
//     no snapshot exists — Cloudflare Pages then keeps the previous
//     deployment live;
//   - `npm run dev` runs without `--required`; OBS_CATALOG_ALLOW_EMPTY=1
//     forces a build through with an empty snapshot (pages then state 0
//     languages — visibly wrong on purpose, never a stale placeholder).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CATALOG_URL =
  'https://git.door43.org/api/v1/catalog/search?subject=Open%20Bible%20Stories&stage=prod';
const OUT = fileURLToPath(new URL('../src/data/catalog.json', import.meta.url));
const required = process.argv.includes('--required') && !process.env.OBS_CATALOG_ALLOW_EMPTY;

const ENTRY_FIELDS = ['owner', 'name', 'branch_or_tag_name', 'title', 'metadata_type'];

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Collapse raw catalog entries into one record per language. */
export function groupLanguages(entries) {
  const byLang = new Map();
  for (const e of entries) {
    if (!e || !e.language) continue;
    if (/theological formation/i.test(e.title || '')) continue;
    const arr = byLang.get(e.language) || [];
    arr.push(e);
    byLang.set(e.language, arr);
  }
  const has = (entries, key) => entries.some((e) => e.attachment_types && e.attachment_types[key]);
  return Array.from(byLang.entries())
    .map(([code, group]) => ({
      code,
      // language_title is the language's own name as recorded in the
      // resource manifest (usually the autonym). No separate English name
      // exists in the catalog, so none is invented here.
      title: group.find((e) => e.language_title)?.language_title || code,
      direction: group.find((e) => e.language_direction)?.language_direction === 'rtl' ? 'rtl' : 'ltr',
      formats: {
        pdf: has(group, 'pdf'),
        audio: has(group, 'audio'),
        // "stream" is how a hosted YouTube link is tagged.
        video: has(group, 'video') || has(group, 'stream'),
      },
      entries: group.map((e) => Object.fromEntries(ENTRY_FIELDS.map((f) => [f, e[f] ?? null]))),
    }))
    .sort((a, b) => a.title.localeCompare(b.title, 'en'));
}

const PAGE_SIZE = 1000;

async function fetchPage(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`DCS catalog responded ${res.status}`);
  const body = await res.json();
  return {
    entries: Array.isArray(body.data) ? body.data : [],
    total: parseInt(res.headers.get('x-total-count') || '', 10),
  };
}

/** Fetch every catalog entry; throws unless the result is complete. */
export async function fetchCatalog() {
  const first = await fetchPage(CATALOG_URL);
  let entries = first.entries;
  const total = Number.isFinite(first.total) ? first.total : entries.length;
  if (entries.length === 0) throw new Error('DCS catalog returned no entries');

  if (total > entries.length) {
    // The unpaged response was cut short. Its page size is unknown, so it
    // cannot be resumed from; start over with explicit 1-indexed pages of a
    // known size and stop when a short page arrives or the total is reached.
    console.warn(`[catalog] first response has ${entries.length} of ${total} entries — re-fetching in pages of ${PAGE_SIZE}.`);
    entries = [];
    const seen = new Set();
    for (let page = 1; entries.length < total; page++) {
      const { entries: more } = await fetchPage(`${CATALOG_URL}&limit=${PAGE_SIZE}&page=${page}`);
      for (const e of more) {
        const key = `${e.owner}/${e.name}@${e.branch_or_tag_name}`;
        if (!seen.has(key)) {
          seen.add(key);
          entries.push(e);
        }
      }
      if (more.length < PAGE_SIZE) break;
    }
    if (entries.length < total) {
      throw new Error(`DCS catalog is truncated: got ${entries.length} of ${total} entries even after paginating`);
    }
  }
  return entries;
}

function writeSnapshot(languages) {
  const now = new Date();
  const snapshot = {
    source: CATALOG_URL,
    fetchedAt: now.toISOString(),
    // Date only, for dateModified in JSON-LD.
    fetchedDate: `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`,
    languageCount: languages.length,
    languages,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(snapshot, null, 1) + '\n');
  return snapshot;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  try {
    const entries = await fetchCatalog();
    const snapshot = writeSnapshot(groupLanguages(entries));
    console.log(`[catalog] ${snapshot.languageCount} languages (${entries.length} entries) → src/data/catalog.json`);
  } catch (err) {
    console.warn(`[catalog] fetch failed: ${err.message}`);
    if (existsSync(OUT)) {
      const prev = JSON.parse(readFileSync(OUT, 'utf8'));
      if (prev.languageCount > 0) {
        console.warn(`[catalog] keeping existing snapshot from ${prev.fetchedAt} (${prev.languageCount} languages)`);
        process.exit(0);
      }
    }
    if (required) {
      console.error('[catalog] no catalog data available and no committed snapshot — refusing to build a site with zero languages. Set OBS_CATALOG_ALLOW_EMPTY=1 to override.');
      process.exit(1);
    }
    writeSnapshot([]);
    console.warn('[catalog] wrote an EMPTY snapshot — every page will state 0 languages. Do not deploy this build.');
  }
}
