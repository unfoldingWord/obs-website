// Build-time snapshot of the published Open Bible Stories catalog.
//
// Runs before `astro build` / `astro dev` (see package.json) and writes
// src/data/catalog.json, which is the ONE source for every public fact about
// "how many languages" and "which languages":
//   - the language count on the homepage and Why OBS page
//   - the prerendered language list on /discover/ (crawlable without JS)
//   - the /l/{code}/ language hubs (one static page per published language)
//   - meta descriptions that mention the count
//   - JSON-LD (ItemList of translations, per-hub CreativeWork)
//   - sitemap-languages.xml
//
// The number is therefore defined as: the count of distinct language codes
// with at least one production-stage "Open Bible Stories" entry in the
// Door43 Content Service (DCS) catalog, excluding the Theological Formation
// edition — exactly the set Discover shows. Changing the catalog changes the
// number on the next build. Nothing at runtime fetches a different count.
//
// Three sources, in order of importance:
//   1. DCS catalog search (required) — the list of languages and entries.
//      Same endpoint and filters as public/assets/js/discover.js: no `limit`
//      (omitting it returns every matching entry), no `metadataType` filter
//      (16 languages only have the older translationStudio format). If the
//      response is shorter than X-Total-Count the whole list is re-fetched
//      in explicit pages; a still-short result is an error, never written.
//   2. translationDatabase langnames.json (optional enrichment) — autonym
//      (where the manifest only has the English name), English name,
//      alternate names, region, country codes and direction per code.
//   3. Release assets (optional enrichment) — when the catalog says a
//      language has a PDF/audio/video but the entry's own release carries no
//      such file (Door43-Catalog releases have no assets), the repo's release
//      history is walked for the newest release that has it, the same way
//      discover.js resolves formats at runtime.
//   4. Story text per language (optional enrichment) — the 50 story titles
//      and a short extract of story 1, straight from each repo. This is
//      ~50 small fetches per language; results are cached in the snapshot
//      and only re-fetched for entries whose release changed, so after the
//      first run a build only fetches what actually moved.
//
// Failure policy: a deploy that ships an empty or partial catalog would
// publish a wrong count and delist translations, so:
//   - the snapshot on disk (src/data/catalog.json, committed as the offline
//     fallback) is only overwritten by a complete, successful catalog fetch;
//   - on catalog failure the existing snapshot is kept, with a warning;
//   - a production build (`--required`) fails only when the catalog fetch
//     fails AND no snapshot exists — Cloudflare Pages then keeps the
//     previous deployment live;
//   - enrichment failures (langnames, a story file) never fail the build:
//     the affected fields fall back to the previous snapshot's values or
//     null, and the hub renders without them;
//   - `npm run dev` runs without `--required`; OBS_CATALOG_ALLOW_EMPTY=1
//     forces a build through with an empty snapshot (pages then state 0
//     languages — visibly wrong on purpose, never a stale placeholder);
//   - OBS_CATALOG_STORIES=0 skips story fetching (offline development).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CATALOG_URL =
  'https://git.door43.org/api/v1/catalog/search?subject=Open%20Bible%20Stories&stage=prod';
export const LANGNAMES_URL = 'https://td.unfoldingword.org/exports/langnames.json';
const OUT = fileURLToPath(new URL('../src/data/catalog.json', import.meta.url));
const required = process.argv.includes('--required') && !process.env.OBS_CATALOG_ALLOW_EMPTY;
const fetchStoriesEnabled = process.env.OBS_CATALOG_STORIES !== '0';

export const STORY_COUNT = 50;


const PAGE_SIZE = 1000;
const CONCURRENCY = 24;
const EXTRACT_MAX_CHARS = 520;

const pad = (n) => String(n).padStart(2, '0');

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in fetch-catalog.test.mjs)
// ---------------------------------------------------------------------------

const ASSET_NAME_RE = /\.(pdf|epub|docx|zip|mp3|mp4|3gp)$/i;
const YOUTUBE_RE = /youtu\.?be/i;

/** Downloadable assets worth listing on a hub, from a catalog entry's release. */
export function compactAssets(entry) {
  return compactAssetList(entry?.release?.assets);
}

function compactAssetList(assets, tag = null) {
  if (!Array.isArray(assets)) return [];
  return assets
    .filter((a) => a && a.name && a.browser_download_url)
    .filter((a) => ASSET_NAME_RE.test(a.name) || YOUTUBE_RE.test(a.browser_download_url))
    .slice(0, 40)
    .map((a) => ({ name: a.name, url: a.browser_download_url, size: Number.isFinite(a.size) ? a.size : null, ...(tag ? { tag } : {}) }));
}

/** Which hub formats a list of assets already covers. */
export function assetFormats(assets) {
  const has = (re) => assets.some((a) => re.test(a.name) || re.test(a.url));
  return {
    pdf: has(/\.pdf$/i),
    audio: has(/\.mp3$|audio|mp3/i),
    video: has(/\.(mp4|3gp)$|video|youtu\.?be/i),
  };
}

/**
 * Fill in formats the catalog advertises (attachment_types) but the entry's
 * own release lacks, from the newest non-draft release of the repo that has
 * them. Mirrors latestReleaseWithExt() in discover.js. Returns the entry's
 * assets plus the found files (tagged with their release), or the original
 * list when nothing is missing or the lookup fails. Never throws.
 */
// One releases lookup per repo per run: the PDF/audio/video backfill and the
// per-story audio map both need the same list.
const releasesCache = new Map();

/** Drop the per-run releases cache. Only needed by tests, which exercise
 *  several fake repos that share owner/name across cases. */
export function clearReleasesCache() {
  releasesCache.clear();
}

/** Non-draft releases of an entry's repo, newest first. [] on any failure. */
async function fetchReleases(entry, fetchImpl = fetch) {
  const key = `${entry.owner}/${entry.name}`;
  if (releasesCache.has(key)) return releasesCache.get(key);
  let ordered = [];
  try {
    const body = await fetchText(`https://git.door43.org/api/v1/repos/${entry.owner}/${entry.name}/releases`, fetchImpl);
    const releases = body ? JSON.parse(body) : [];
    if (Array.isArray(releases)) {
      ordered = releases
        .filter((r) => r && !r.draft)
        .sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0));
    }
  } catch {
    ordered = [];
  }
  releasesCache.set(key, ordered);
  return ordered;
}

/**
 * Per-story mp3 URLs for one entry, or {} when the repo publishes none.
 * The entry's own `assets` list is capped at 40 files and so cannot hold a
 * 50-story audio set — this reads the release history directly.
 */
export async function fetchStoryAudio(entry, fetchImpl = fetch) {
  if (!entry?.owner || !entry?.name) return {};
  return audioByStory(await fetchReleases(entry, fetchImpl));
}

export async function fetchMissingAssets(entry, wanted, fetchImpl = fetch) {
  const own = entry.assets || [];
  const have = assetFormats(own);
  const missing = ['pdf', 'audio', 'video'].filter((k) => wanted[k] && !have[k]);
  if (!missing.length || !entry.owner || !entry.name) return own;
  const ordered = await fetchReleases(entry, fetchImpl);
  if (!ordered.length) return own;
  const extra = [];
  for (const key of missing) {
    for (const r of ordered) {
      const compact = compactAssetList(r.assets, r.tag_name || null);
      const found = compact.filter((a) => assetFormats([a])[key]);
      if (found.length) {
        extra.push(...found.filter((a) => !own.some((o) => o.url === a.url) && !extra.some((o) => o.url === a.url)));
        break;
      }
    }
  }
  return extra.length ? [...own, ...extra] : own;
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
  const has = (group, key) => group.some((e) => e.attachment_types && e.attachment_types[key]);
  return Array.from(byLang.entries())
    .map(([code, group]) => {
      const released = group.map((e) => e.released).filter(Boolean).sort();
      return {
        code,
        // language_title is the language's own name as recorded in the
        // resource manifest (usually the autonym). The English name comes
        // from langnames.json (applyLangnames), never invented here.
        title: group.find((e) => e.language_title)?.language_title || code,
        englishName: null,
        altNames: [],
        region: null,
        countryCodes: [],
        direction: group.find((e) => e.language_direction)?.language_direction === 'rtl' ? 'rtl' : 'ltr',
        script: 'latin',
        formats: {
          pdf: has(group, 'pdf'),
          audio: has(group, 'audio'),
          // "stream" is how a hosted YouTube link is tagged.
          video: has(group, 'video') || has(group, 'stream'),
        },
        /** Most recent release date across teams (ISO date), for lastmod. */
        updated: released.length ? released[released.length - 1].slice(0, 10) : null,
        entries: group.map((e) => ({
          owner: e.owner ?? null,
          name: e.name ?? null,
          branch_or_tag_name: e.branch_or_tag_name ?? null,
          title: e.title ?? null,
          metadata_type: e.metadata_type ?? null,
          released: e.released ? String(e.released).slice(0, 10) : null,
          contentPath: contentPathFor(e),
          assets: compactAssets(e),
        })),
        stories: null,
        extract: null,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title, 'en'));
}

function contentPathFor(entry) {
  const ing = entry.ingredients && entry.ingredients[0];
  if (!ing || !ing.path) return 'content';
  return String(ing.path).replace(/^\.\/?/, '').replace(/\/$/, '') || 'content';
}

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const isAscii = (s) => /^[\x00-\x7f]*$/.test(String(s));

/**
 * Decide the autonym for a language from the manifest title and its
 * langnames row. The DCS manifest's language_title is often the English
 * name ("Swahili", "Arabic", "Chinese, Simplified") or English in
 * parentheses ("हिन्दी (Hindi)"), so langnames.ln (first comma-separated
 * segment) is used when:
 *   - the manifest title equals the code, or
 *   - it equals the English name (ang) case-insensitively, or
 *   - it is "<something> (<ang>)", or
 *   - it is plain ASCII while ln is written in another script.
 * Otherwise the manifest title stands (e.g. es-419 "Español de
 * Latinoamérica" beats langnames' "Español Latin America").
 */
export function chooseAutonym(title, code, row) {
  const ln = String(row?.ln ?? '').split(',')[0].trim();
  if (!ln) return title;
  const ang = norm(row?.ang);
  const t = norm(title);
  if (!t || t === norm(code)) return ln;
  if (ang && t === ang) return ln;
  const paren = t.match(/^(.+?)\s*\((.+)\)$/);
  if (paren && ang && norm(paren[2]) === ang) return ln;
  if (isAscii(title) && !isAscii(ln)) return ln;
  return title;
}

/**
 * Merge translationDatabase langnames into the language records. langnames
 * rows look like { lc, ln, ang, ld, lr, alt: [], cc: [] }. Fills the fields
 * the catalog does not have, and replaces an English manifest title with the
 * autonym (see chooseAutonym).
 */
export function applyLangnames(languages, langnames) {
  if (!Array.isArray(langnames)) return languages;
  const byCode = new Map();
  for (const row of langnames) if (row && row.lc) byCode.set(String(row.lc).toLowerCase(), row);
  return languages.map((lang) => {
    const row = byCode.get(lang.code.toLowerCase());
    if (!row) return lang;
    const autonym = chooseAutonym(lang.title, lang.code, row);
    const english = row.ang && norm(row.ang) !== norm(autonym) ? String(row.ang).trim() : null;
    const alt = Array.isArray(row.alt) ? row.alt.filter((n) => n && norm(n) !== norm(autonym) && norm(n) !== norm(english)) : [];
    return {
      ...lang,
      title: autonym,
      englishName: english,
      altNames: Array.from(new Set(alt)).slice(0, 12),
      region: row.lr || null,
      countryCodes: Array.isArray(row.cc) ? row.cc.slice(0, 12) : [],
      direction: row.ld === 'rtl' ? 'rtl' : lang.direction,
    };
  });
}

/**
 * Display order for the language list: by English name where known, else
 * the autonym. Sorting by autonym would sink every non-Latin script below
 * all Latin names, so a Hindi or Arabic reader would scroll past everything.
 */
export function sortLanguages(languages) {
  const key = (l) => l.englishName || l.title || l.code;
  return [...languages].sort((a, b) => key(a).localeCompare(key(b), 'en'));
}

/**
 * Parse one Resource Container story markdown file.
 *
 * Returns `paragraphs` (text only, for the hub extract) and `frames` — each
 * illustration paired with the text that follows it, which is what a story
 * page renders. Story images are language-independent: every translation
 * references the same cdn.door43.org/obs/jpg/.../obs-en-{NN}-{FF}.jpg files.
 */
export function parseStoryMarkdown(md) {
  const body = String(md).replace(/^---\n[\s\S]*?\n---\n/, '');
  const blocks = body.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  let title = '';
  let reference = '';
  const paragraphs = [];
  const frames = [];
  let pendingImage = null;
  blocks.forEach((block, i) => {
    const heading = i === 0 && block.match(/^#{1,6}\s*(.*)$/);
    if (heading) {
      title = heading[1].trim();
      return;
    }
    const image = block.match(/^!\[[^\]]*\]\(([^)\s]+)[^)]*\)$/);
    if (image) {
      pendingImage = image[1];
      return;
    }
    const ref = i === blocks.length - 1 && block.match(/^[_*](.+)[_*]$/);
    if (ref) {
      reference = ref[1].trim();
      return;
    }
    const text = block.replace(/\s+/g, ' ').trim();
    paragraphs.push(text);
    frames.push({ image: pendingImage, text });
    pendingImage = null;
  });
  return { title, paragraphs, reference, frames };
}

/**
 * Map story number -> mp3 URL from a repo's release assets, newest release
 * first. Mirrors the reader's old latestReleaseWithAllExt('.mp3'): a text
 * release and an audio release are often different tags. Prefers the higher
 * bitrate when a story ships several (…_01_128kbps.mp3 over …_01_32kbps.mp3).
 */
export function audioByStory(releases) {
  const bitrate = (name) => {
    const m = name.match(/(\d+)kbps/i);
    return m ? parseInt(m[1], 10) : 0;
  };
  for (const release of releases || []) {
    const out = {};
    for (const a of release?.assets || []) {
      if (!a || !a.name || !a.browser_download_url || !/\.mp3$/i.test(a.name)) continue;
      const m = a.name.match(/(?:^|[_-])(\d{2})(?:[_-]|\.)/);
      if (!m) continue;
      const n = parseInt(m[1], 10);
      if (n < 1 || n > STORY_COUNT) continue;
      const prev = out[n];
      if (!prev || bitrate(a.name) > bitrate(prev.name)) out[n] = { name: a.name, url: a.browser_download_url };
    }
    const nums = Object.keys(out);
    if (nums.length) {
      const urls = {};
      for (const n of nums) urls[n] = out[n].url;
      return urls;
    }
  }
  return {};
}

/**
 * Per-story video URLs from a release history, the same shape and rule as
 * audioByStory: the story number is the two-digit group in the filename
 * (`en_obs_v6_23_360p.mp4`), and where a story has several renditions the
 * SMALLEST resolution wins. A 70MB 720p file is not what to put in a page
 * for someone on a phone in a place where OBS is most used; the hub still
 * links the whole set.
 */
export function videoByStory(releases) {
  const height = (name) => {
    const m = name.match(/(\d{3,4})p/i);
    return m ? parseInt(m[1], 10) : 99999;
  };
  for (const release of releases || []) {
    const out = {};
    for (const a of release?.assets || []) {
      if (!a || !a.name || !a.browser_download_url || !/\.(mp4|3gp)$/i.test(a.name)) continue;
      const m = a.name.match(/(?:^|[_-])(\d{2})(?:[_-]|\.)/);
      if (!m) continue;
      const n = parseInt(m[1], 10);
      if (n < 1 || n > STORY_COUNT) continue;
      const prev = out[n];
      if (!prev || height(a.name) < height(prev.name)) out[n] = { name: a.name, url: a.browser_download_url };
    }
    const nums = Object.keys(out);
    if (nums.length) {
      const urls = {};
      for (const n of nums) urls[n] = out[n].url;
      return urls;
    }
  }
  return {};
}

/**
 * Per-story video URLs for one entry, or {} when the repo publishes none.
 * Same reason as fetchStoryAudio for reading the release history rather than
 * the entry's capped `assets` list.
 */
export async function fetchStoryVideo(entry, fetchImpl = fetch) {
  if (!entry?.owner || !entry?.name) return {};
  return videoByStory(await fetchReleases(entry, fetchImpl));
}

/** First paragraphs of a story, capped, for the hub's in-language extract. */
export function makeExtract({ title, paragraphs, reference }, maxChars = EXTRACT_MAX_CHARS) {
  let text = '';
  for (const p of paragraphs) {
    if (!p) continue;
    const next = text ? `${text} ${p}` : p;
    if (next.length > maxChars) {
      if (!text) text = `${p.slice(0, maxChars - 1).trimEnd()}…`;
      break;
    }
    text = next;
  }
  if (!text) return null;
  return { title: title || null, text, reference: reference || null };
}

/**
 * Which self-hosted font pack a text needs, by dominant Unicode block.
 *
 * Every name returned here except `other` must have an entry in the PACKS
 * map in scripts/build-font-css.mjs, a matching `html[data-script="…"]`
 * rule in public/assets/css/styles.css, and be listed in
 * `fontHrefForScript()` in src/data/catalog.ts — otherwise the language
 * renders in whatever face the visitor's OS happens to have, which for most
 * of these scripts is nothing at all. `other` is the honest fallback for a
 * script we ship no pack for; it should be empty for the current catalog
 * (see `npm run check:scripts`).
 */
export function detectScript(text) {
  const counts = {
    arabic: 0, devanagari: 0, bengali: 0, gurmukhi: 0, gujarati: 0, oriya: 0,
    tamil: 0, telugu: 0, kannada: 0, malayalam: 0, lao: 0, ethiopic: 0,
    myanmar: 0, han: 0, cyrillic: 0, latin: 0, other: 0,
  };
  for (const ch of String(text || '')) {
    const c = ch.codePointAt(0);
    if (c < 0x80 || (c >= 0xc0 && c <= 0x24f)) { if (/\p{L}/u.test(ch)) counts.latin++; }
    else if (c >= 0x400 && c <= 0x52f) counts.cyrillic++;
    else if ((c >= 0x600 && c <= 0x6ff) || (c >= 0x750 && c <= 0x77f) || (c >= 0xfb50 && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff)) counts.arabic++;
    // Danda and double danda live in the Devanagari block but are shared
    // punctuation across the Indic scripts below — counting them as
    // Devanagari is what made short Odia and Gujarati samples ambiguous.
    else if (c === 0x964 || c === 0x965) { /* shared Indic punctuation */ }
    else if (c >= 0x900 && c <= 0x97f) counts.devanagari++;
    else if (c >= 0x980 && c <= 0x9ff) counts.bengali++;
    else if (c >= 0xa00 && c <= 0xa7f) counts.gurmukhi++;
    else if (c >= 0xa80 && c <= 0xaff) counts.gujarati++;
    else if (c >= 0xb00 && c <= 0xb7f) counts.oriya++;
    else if (c >= 0xb80 && c <= 0xbff) counts.tamil++;
    else if (c >= 0xc00 && c <= 0xc7f) counts.telugu++;
    else if (c >= 0xc80 && c <= 0xcff) counts.kannada++;
    else if (c >= 0xd00 && c <= 0xd7f) counts.malayalam++;
    else if (c >= 0xe80 && c <= 0xeff) counts.lao++;
    else if ((c >= 0x1200 && c <= 0x139f) || (c >= 0x2d80 && c <= 0x2ddf)) counts.ethiopic++;
    else if (c >= 0x1000 && c <= 0x109f) counts.myanmar++;
    else if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0x3000 && c <= 0x30ff)) counts.han++;
    else if (/\p{L}/u.test(ch)) counts.other++;
  }
  let best = 'latin';
  for (const [k, v] of Object.entries(counts)) if (v > counts[best]) best = k;
  return best;
}

/**
 * Font pack for a language: the dominant script of its text, except that
 * Urdu-family codes written in Arabic script take the Nastaliq pack
 * (styles.css keys on this value via <html data-script>).
 */
export function scriptFor(code, sample) {
  const script = sample ? detectScript(sample) : 'latin';
  if (script === 'arabic' && /^ur(?:$|[-_])/i.test(code) && !/deva/i.test(code)) return 'nastaliq';
  return script;
}

/** Story file URLs for one entry, mirroring public/assets/js/discover.js. */
export function storyUrls(entry, num) {
  const base = `https://git.door43.org/${entry.owner}/${entry.name}/raw/${entry.branch_or_tag_name}`;
  const nn = pad(num);
  if (entry.metadata_type === 'ts') {
    return { title: `${base}/${nn}/title.txt`, frames: [`${base}/${nn}/01.txt`, `${base}/${nn}/02.txt`], reference: `${base}/${nn}/reference.txt`, rc: null };
  }
  return { rc: `${base}/${entry.contentPath || 'content'}/${nn}.md` };
}

/** Identity of the release the cached stories were fetched from. */
export function entryKey(entry) {
  return `${entry.owner}/${entry.name}@${entry.branch_or_tag_name}#${entry.released ?? ''}`;
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

async function fetchText(url, fetchImpl, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetchImpl(url);
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) return null;
      return await res.text();
    } catch (err) {
      if (i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  return null;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function fetchPage(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`DCS catalog responded ${res.status}`);
  const body = await res.json();
  return {
    entries: Array.isArray(body.data) ? body.data : [],
    total: parseInt(res.headers.get('x-total-count') || '', 10),
  };
}

/** Fetch every catalog entry; throws unless the result is complete. */
export async function fetchCatalog(fetchImpl = fetch) {
  const first = await fetchPage(CATALOG_URL, fetchImpl);
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
      const { entries: more } = await fetchPage(`${CATALOG_URL}&limit=${PAGE_SIZE}&page=${page}`, fetchImpl);
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

/**
 * Fetch the 50 story titles and the story-1 extract for one language. Tries
 * each publishing team's entry in order and keeps the first that yields any
 * story (some repos are incomplete at their tagged release). Returns
 * { stories, extract, script }; a story that cannot be read gets a null
 * title, and `stories` is null when no entry has any. Never throws.
 */
export async function fetchStories(language, fetchImpl = fetch) {
  let result = { stories: null, extract: null, script: 'latin' };
  for (const entry of language.entries) {
    if (!entry?.owner || !entry?.name || !entry?.branch_or_tag_name) continue;
    result = await fetchStoriesFrom(language.code, entry, fetchImpl);
    if (result.stories) break;
  }
  return result;
}

async function fetchStoriesFrom(code, entry, fetchImpl) {
  const nums = Array.from({ length: STORY_COUNT }, (_, i) => i + 1);
  let extract = null;
  const stories = await mapLimit(nums, 8, async (num) => {
    const urls = storyUrls(entry, num);
    try {
      if (urls.rc) {
        const md = await fetchText(urls.rc, fetchImpl);
        if (md == null) return { num, title: null };
        const parsed = parseStoryMarkdown(md);
        if (num === 1) extract = makeExtract(parsed);
        return {
          num,
          title: parsed.title || null,
          body: parsed.frames.length
            ? { reference: parsed.reference || null, frames: parsed.frames }
            : null,
        };
      }
      const title = (await fetchText(urls.title, fetchImpl))?.trim() || null;
      // Legacy translationStudio repos store each frame in its own file and
      // only the first two are fetched here, so a ts story yields a title and
      // an extract but no full body — it gets no story page.
      if (num === 1) {
        const frames = [];
        for (const u of urls.frames) {
          const t = await fetchText(u, fetchImpl);
          if (t && t.trim()) frames.push(t.trim());
        }
        const reference = (await fetchText(urls.reference, fetchImpl))?.trim() || '';
        extract = makeExtract({ title: title || '', paragraphs: frames, reference });
      }
      return { num, title, body: null };
    } catch (err) {
      return { num, title: null };
    }
  });
  const anyTitle = stories.some((s) => s.title);
  return { stories: anyTitle ? stories : null, extract, script: scriptFor(code, scriptSample({ extract, stories })) };
}

/**
 * The text the script detector reads for a language: its extract plus every
 * story title. Used both after a fetch and when reusing a cached snapshot
 * record, so a language's `script` is always what the CURRENT detector makes
 * of its text — widening detectScript() takes effect on the next build
 * instead of waiting for that language to publish a new release.
 */
export function scriptSample({ extract, stories }) {
  return [extract?.title, extract?.text, ...(stories || []).map((s) => s.title)].filter(Boolean).join(' ');
}

/**
 * Enrich every language with stories/extract, reusing the previous snapshot
 * for entries whose release has not changed.
 */
export async function enrichStories(languages, previous, fetchImpl = fetch, log = console, storiesDir = STORIES_DIR) {
  const prevByCode = new Map((previous?.languages || []).map((l) => [l.code, l]));
  const keyOf = (l) => (l.entries || []).map(entryKey).join('|');
  let fetched = 0;
  let reused = 0;
  const out = await mapLimit(languages, Math.max(1, Math.floor(CONCURRENCY / 8)), async (lang) => {
    const prev = prevByCode.get(lang.code);
    // Story bodies live in src/data/stories/, which is gitignored: a cached
    // catalog entry is only reusable when that file survived too, otherwise
    // the language would end up with a hub and no story pages.
    if (prev && prev.stories && keyOf(prev) === keyOf(lang) && hasStoryFile(lang.code, storiesDir)) {
      reused++;
      return {
        ...lang,
        stories: prev.stories,
        storyNums: prev.storyNums ?? [],
        extract: prev.extract,
        // Re-derived, not copied: see scriptSample().
        script: scriptFor(lang.code, scriptSample(prev)) || prev.script || lang.script,
      };
    }
    const result = await fetchStories(lang, fetchImpl);
    fetched++;
    return { ...lang, ...result };
  });
  log.log(`[catalog] stories: fetched ${fetched} languages, reused ${reused} from the previous snapshot`);
  return out;
}

/**
 * Enrich entries whose release lacks an advertised PDF/audio/video with the
 * newest release that has it (see fetchMissingAssets). Cached per entry in
 * the snapshot: an entry with the same entryKey reuses its previous assets.
 */
export async function enrichAssets(languages, previous, fetchImpl = fetch, log = console) {
  const prevEntries = new Map();
  for (const l of previous?.languages || []) for (const e of l.entries || []) prevEntries.set(entryKey(e), e);
  let fetched = 0;
  let reused = 0;
  const out = await mapLimit(languages, 6, async (lang) => {
    const wanted = lang.formats;
    const entries = [];
    for (const entry of lang.entries) {
      const prev = prevEntries.get(entryKey(entry));
      if (prev && Array.isArray(prev.assets)) {
        reused++;
        entries.push({ ...entry, assets: prev.assets });
        continue;
      }
      const assets = await fetchMissingAssets(entry, wanted, fetchImpl);
      if (assets !== entry.assets) fetched++;
      entries.push({ ...entry, assets });
    }
    // Per-story mp3s for the story pages. Only for languages that advertise
    // audio, and the releases list is cached, so this adds no fetches for
    // entries whose assets were just looked up.
    let storyAudio;
    if (wanted.audio) {
      for (const entry of lang.entries) {
        const map = await fetchStoryAudio(entry, fetchImpl);
        if (Object.keys(map).length) { storyAudio = map; break; }
      }
    }
    // Per-story video files, same rule (#16): a story page should offer that
    // story's own recording rather than sending everyone to a multi-gigabyte
    // zip of all 50. Playlist links (most languages publish a YouTube
    // playlist, not files) are not per-story and stay on the hub.
    let storyVideo;
    if (wanted.video) {
      for (const entry of lang.entries) {
        const map = await fetchStoryVideo(entry, fetchImpl);
        if (Object.keys(map).length) { storyVideo = map; break; }
      }
    }
    return { ...lang, entries, ...(storyAudio ? { storyAudio } : {}), ...(storyVideo ? { storyVideo } : {}) };
  });
  log.log(`[catalog] assets: looked up ${fetched} release histories, reused ${reused} entries from the previous snapshot`);
  return out;
}

export function buildSnapshot(languages) {
  const now = new Date();
  return {
    source: CATALOG_URL,
    fetchedAt: now.toISOString(),
    // Date only, for dateModified in JSON-LD.
    fetchedDate: `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`,
    languageCount: languages.length,
    languages,
  };
}

const STORIES_DIR = fileURLToPath(new URL('../src/data/stories', import.meta.url));

/** True when this language already has its story file on disk. */
export function hasStoryFile(code, dir = STORIES_DIR) {
  return existsSync(join(dir, `${code}.json`));
}

/**
 * Split the story bodies out of the snapshot into one file per language
 * (src/data/stories/{code}.json, generated and gitignored — together they are
 * tens of MB, far too much for the committed catalog).
 *
 * Mutates each language: `stories` keeps only {num,title} for the hub list,
 * and `storyNums` records which stories actually have a page. Hub links, the
 * story routes and sitemap-stories.xml all read `storyNums`, so they cannot
 * disagree about which pages exist.
 */
export function writeStoryFiles(languages, dir = STORIES_DIR) {
  mkdirSync(dir, { recursive: true });
  let written = 0;
  for (const lang of languages) {
    const audio = lang.storyAudio || {};
    const video = lang.storyVideo || {};
    const full = (lang.stories || [])
      .filter((s) => s.body && s.body.frames.length)
      .map((s) => ({
        num: s.num,
        title: s.title || `Story ${s.num}`,
        reference: s.body.reference,
        frames: s.body.frames,
        audio: audio[s.num] || null,
        video: video[s.num] || null,
      }));
    lang.stories = (lang.stories || []).map((s) => ({ num: s.num, title: s.title }));
    delete lang.storyAudio;
    delete lang.storyVideo;
    if (!full.length) {
      // Reused from the previous snapshot: the bodies were never re-fetched,
      // but the file is still on disk, so keep the numbers it already had.
      if (!(Array.isArray(lang.storyNums) && hasStoryFile(lang.code, dir))) lang.storyNums = [];
      continue;
    }
    lang.storyNums = full.map((s) => s.num);
    writeFileSync(join(dir, `${lang.code}.json`), JSON.stringify({ code: lang.code, stories: full }) + '\n');
    written++;
  }
  return written;
}

function writeSnapshot(snapshot) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(snapshot, null, 1) + '\n');
  return snapshot;
}

function readPrevious() {
  if (!existsSync(OUT)) return null;
  try {
    return JSON.parse(readFileSync(OUT, 'utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const previous = readPrevious();
  let entries;
  try {
    entries = await fetchCatalog();
  } catch (err) {
    console.warn(`[catalog] fetch failed: ${err.message}`);
    if (previous && previous.languageCount > 0) {
      console.warn(`[catalog] keeping existing snapshot from ${previous.fetchedAt} (${previous.languageCount} languages)`);
      process.exit(0);
    }
    if (required) {
      console.error('[catalog] no catalog data available and no committed snapshot — refusing to build a site with zero languages. Set OBS_CATALOG_ALLOW_EMPTY=1 to override.');
      process.exit(1);
    }
    writeSnapshot(buildSnapshot([]));
    console.warn('[catalog] wrote an EMPTY snapshot — every page will state 0 languages. Do not deploy this build.');
    process.exit(0);
  }

  let languages = groupLanguages(entries);

  // Optional enrichment 1: names/regions from translationDatabase.
  try {
    const res = await fetch(LANGNAMES_URL, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    languages = applyLangnames(languages, await res.json());
  } catch (err) {
    console.warn(`[catalog] langnames unavailable (${err.message}) — reusing names from the previous snapshot where possible`);
    const prevByCode = new Map((previous?.languages || []).map((l) => [l.code, l]));
    languages = languages.map((l) => {
      const p = prevByCode.get(l.code);
      return p ? { ...l, englishName: p.englishName ?? null, altNames: p.altNames ?? [], region: p.region ?? null, countryCodes: p.countryCodes ?? [], direction: p.direction ?? l.direction } : l;
    });
  }

  languages = sortLanguages(languages);

  // Optional enrichment 2: PDFs/audio/video from older releases, incrementally.
  languages = await enrichAssets(languages, previous);

  // Optional enrichment 3: story titles + extract, incrementally.
  if (fetchStoriesEnabled) {
    languages = await enrichStories(languages, previous);
  } else {
    console.warn('[catalog] OBS_CATALOG_STORIES=0 — skipping story fetch; hubs will have no titles/extracts');
  }

  const storyFiles = writeStoryFiles(languages);
  const snapshot = writeSnapshot(buildSnapshot(languages));
  const withExtract = languages.filter((l) => l.extract).length;
  const withPages = languages.filter((l) => (l.storyNums || []).length).length;
  const storyPages = languages.reduce((n, l) => n + (l.storyNums || []).length, 0);
  console.log(`[catalog] ${snapshot.languageCount} languages (${entries.length} entries), ${withExtract} with story extracts → src/data/catalog.json`);
  console.log(`[catalog] stories: ${storyFiles} file(s) written, ${withPages} languages with ${storyPages} story pages → src/data/stories/`);
}
