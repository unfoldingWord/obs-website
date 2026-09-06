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
import { dirname } from 'node:path';
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
export async function fetchMissingAssets(entry, wanted, fetchImpl = fetch) {
  const own = entry.assets || [];
  const have = assetFormats(own);
  const missing = ['pdf', 'audio', 'video'].filter((k) => wanted[k] && !have[k]);
  if (!missing.length || !entry.owner || !entry.name) return own;
  let releases;
  try {
    const body = await fetchText(`https://git.door43.org/api/v1/repos/${entry.owner}/${entry.name}/releases`, fetchImpl);
    releases = body ? JSON.parse(body) : [];
  } catch {
    return own;
  }
  if (!Array.isArray(releases)) return own;
  const ordered = releases
    .filter((r) => r && !r.draft)
    .sort((a, b) => new Date(b.published_at || 0) - new Date(a.published_at || 0));
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

/** Parse one Resource Container story markdown file into title/paragraphs/reference. */
export function parseStoryMarkdown(md) {
  const body = String(md).replace(/^---\n[\s\S]*?\n---\n/, '');
  const blocks = body.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  let title = '';
  let reference = '';
  const paragraphs = [];
  blocks.forEach((block, i) => {
    const heading = i === 0 && block.match(/^#{1,6}\s*(.*)$/);
    if (heading) {
      title = heading[1].trim();
      return;
    }
    if (/^!\[[^\]]*\]\([^)]+\)$/.test(block)) return; // image line
    const ref = i === blocks.length - 1 && block.match(/^[_*](.+)[_*]$/);
    if (ref) {
      reference = ref[1].trim();
      return;
    }
    paragraphs.push(block.replace(/\s+/g, ' ').trim());
  });
  return { title, paragraphs, reference };
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

/** Which self-hosted font pack a text needs, by dominant Unicode block. */
export function detectScript(text) {
  const counts = { arabic: 0, devanagari: 0, bengali: 0, myanmar: 0, han: 0, cyrillic: 0, latin: 0, other: 0 };
  for (const ch of String(text || '')) {
    const c = ch.codePointAt(0);
    if (c < 0x80 || (c >= 0xc0 && c <= 0x24f)) { if (/\p{L}/u.test(ch)) counts.latin++; }
    else if (c >= 0x400 && c <= 0x52f) counts.cyrillic++;
    else if ((c >= 0x600 && c <= 0x6ff) || (c >= 0x750 && c <= 0x77f) || (c >= 0xfb50 && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfeff)) counts.arabic++;
    else if (c >= 0x900 && c <= 0x97f) counts.devanagari++;
    else if (c >= 0x980 && c <= 0x9ff) counts.bengali++;
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
        return { num, title: parsed.title || null };
      }
      const title = (await fetchText(urls.title, fetchImpl))?.trim() || null;
      if (num === 1) {
        const frames = [];
        for (const u of urls.frames) {
          const t = await fetchText(u, fetchImpl);
          if (t && t.trim()) frames.push(t.trim());
        }
        const reference = (await fetchText(urls.reference, fetchImpl))?.trim() || '';
        extract = makeExtract({ title: title || '', paragraphs: frames, reference });
      }
      return { num, title };
    } catch (err) {
      return { num, title: null };
    }
  });
  const sample = [extract?.title, extract?.text, ...stories.map((s) => s.title)].filter(Boolean).join(' ');
  const anyTitle = stories.some((s) => s.title);
  return { stories: anyTitle ? stories : null, extract, script: scriptFor(code, sample) };
}

/**
 * Enrich every language with stories/extract, reusing the previous snapshot
 * for entries whose release has not changed.
 */
export async function enrichStories(languages, previous, fetchImpl = fetch, log = console) {
  const prevByCode = new Map((previous?.languages || []).map((l) => [l.code, l]));
  const keyOf = (l) => (l.entries || []).map(entryKey).join('|');
  let fetched = 0;
  let reused = 0;
  const out = await mapLimit(languages, Math.max(1, Math.floor(CONCURRENCY / 8)), async (lang) => {
    const prev = prevByCode.get(lang.code);
    if (prev && prev.stories && keyOf(prev) === keyOf(lang)) {
      reused++;
      return { ...lang, stories: prev.stories, extract: prev.extract, script: prev.script || lang.script };
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
    return { ...lang, entries };
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

  const snapshot = writeSnapshot(buildSnapshot(languages));
  const withExtract = languages.filter((l) => l.extract).length;
  console.log(`[catalog] ${snapshot.languageCount} languages (${entries.length} entries), ${withExtract} with story extracts → src/data/catalog.json`);
}
