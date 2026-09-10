// `npm run check:routes` — post-build assertions about the public URL scheme.
// Run after `npm run build`. Astro has no test harness here, and the failure
// mode this change can introduce is a sitemap URL with no page behind it, so
// this mirrors the check-locales.mjs pattern and gates the invariants:
//
//   1. every sitemap <loc> resolves to a built page
//   2. the retired /discover/read/ route stays gone, and nothing links to it
//   3. every language with story pages links to them from its hub, and every
//      hub that lists titles offers some way to read them (never a self-link)
//   4. every internal link into /l/ resolves to a built page
//   5. the output fits Cloudflare Pages' 20,000-file limit
//   6. /llms.txt lists only URLs that were built, and every markdown mirror
//   7. every chrome string a single-URL page registers for the browser-side
//      locale swap resolves in all 16 locale bundles
//   8. no story page is a "Video only" placeholder published as story text
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const CATALOG = fileURLToPath(new URL('../src/data/catalog.json', import.meta.url));
const SITE = 'https://openbiblestories.org';
const MAX_FILES = 20000;
const errors = [];

if (!existsSync(DIST)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

// 2a. The retired route.
if (existsSync(join(DIST, 'discover/read'))) {
  errors.push('dist/discover/read/ exists — the standalone reader must be gone.');
}

// 1. Every sitemap URL must have a page.
let checked = 0;
const locCount = new Map();
for (const name of ['sitemap-pages.xml', 'sitemap-languages.xml', 'sitemap-stories.xml']) {
  const file = join(DIST, name);
  if (!existsSync(file)) {
    errors.push(`${name} is missing`);
    continue;
  }
  let count = 0;
  for (const m of readFileSync(file, 'utf8').matchAll(/<loc>([^<]*)<\/loc>/g)) {
    const path = m[1].startsWith(SITE) ? m[1].slice(SITE.length) : null;
    if (!path) {
      errors.push(`${name}: <loc> is not on the canonical host: ${m[1]}`);
      continue;
    }
    checked++;
    count++;
    if (!existsSync(join(DIST, path, 'index.html'))) errors.push(`${name}: no page for ${path}`);
  }
  locCount.set(name, count);
}

// 1a. The index must advertise exactly the sitemaps that have URLs. An empty
// <urlset> is invalid against the sitemaps.org schema (and Search Console
// reports it as an empty sitemap), so a build with no story text — an outage,
// or a fresh clone with no fetch — must leave sitemap-stories.xml out.
const indexFile = join(DIST, 'sitemap-index.xml');
if (!existsSync(indexFile)) {
  errors.push('sitemap-index.xml is missing');
} else {
  const listed = [...readFileSync(indexFile, 'utf8').matchAll(/<loc>[^<]*\/([^/<]+\.xml)<\/loc>/g)].map((m) => m[1]);
  for (const [name, count] of locCount) {
    if (count > 0 && !listed.includes(name)) errors.push(`sitemap-index.xml does not list ${name} (${count} URLs)`);
    if (count === 0 && listed.includes(name)) errors.push(`sitemap-index.xml lists ${name}, which has no URLs`);
  }
}

// 3. Hub story links and the built story pages must agree.
const { languages } = JSON.parse(readFileSync(CATALOG, 'utf8'));
let storyPages = 0;
let builtStories = 0;
for (const lang of languages) {
  const nums = lang.storyNums ?? [];
  storyPages += nums.length;
  const hub = join(DIST, 'l', lang.code, 'index.html');
  if (!existsSync(hub)) {
    errors.push(`no hub built for ${lang.code}`);
    continue;
  }
  // Compare against the pages this build actually produced, not against the
  // snapshot's storyNums: a build with no story text (a Door43 outage, or a
  // clone with src/data/stories/ absent) legitimately ships hubs and no
  // story pages, and that must stay a clean build rather than an error.
  const built = new Set(
    readdirSync(join(DIST, 'l', lang.code), { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^story-\d+$/.test(d.name))
      .map((d) => parseInt(d.name.slice(6), 10))
  );
  builtStories += built.size;
  const html = readFileSync(hub, 'utf8');
  const escaped = lang.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const linked = new Set(
    [...html.matchAll(new RegExp(`href="/l/${escaped}/story-(\\d+)/"`, 'g'))].map((m) => parseInt(m[1], 10))
  );
  const unlinked = [...built].filter((n) => !linked.has(n));
  if (unlinked.length) errors.push(`/l/${lang.code}/ does not link ${unlinked.length} of the ${built.size} story pages built for it`);
  const dangling = [...linked].filter((n) => !built.has(n));
  if (dangling.length) errors.push(`/l/${lang.code}/ links ${dangling.length} story page(s) that were not built: ${dangling.slice(0, 3).join(', ')}`);
}

// 3a. Every hub that lists story titles must offer a way to reach them.
//
// This is the check that was missing when "Read online" on the 18 legacy
// (translationStudio) hubs pointed at the hub's own URL: the link existed and
// resolved — to the page it was already on — so it reloaded and did nothing.
// A link-existence check cannot see that; a *self*-link in a read control is
// the signal, so this looks for one, and for the presence of at least one
// reader entry point (a story-page link, `#story-N`, or `#read`).
for (const lang of languages) {
  const hub = join(DIST, 'l', lang.code, 'index.html');
  if (!existsSync(hub)) continue;
  const titles = (lang.stories ?? []).filter((s) => s.title).length;
  if (!titles) continue;
  const html = readFileSync(hub, 'utf8');
  const escaped = lang.code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const actions = html.match(/<ul class="hub-format-list">[\s\S]*?<\/ul>/);
  if (actions && new RegExp(`href="/l/${escaped}/"`).test(actions[0])) {
    errors.push(`/l/${lang.code}/ has a read control pointing at the hub itself — clicking it reloads the page and opens nothing`);
  }
  const canRead =
    new RegExp(`href="/l/${escaped}/story-\\d+/"`).test(html) || /href="#story-\d+"/.test(html) || /href="#read"/.test(html);
  if (!canRead) {
    errors.push(`/l/${lang.code}/ lists ${titles} story title(s) but offers no way to read them (no story page, no #story-N, no #read)`);
  }
}

// 3b. A control must resolve to something that can keep its promise.
//
// The generalisation of check 3a, and of two findings that were the same
// shape as it: "Listen (audio)" appeared on 92 hubs and resolved to a story
// page with no player on 78 of them (their only "audio" was a YouTube
// playlist, which is video), and "Read online" appeared on the 14 languages
// whose repo is a "Video only" placeholder. A link that exists and resolves
// is not the same as a link that delivers.
for (const lang of languages) {
  const hub = join(DIST, 'l', lang.code, 'index.html');
  if (!existsSync(hub)) continue;
  const html = readFileSync(hub, 'utf8');
  const actions = html.match(/<ul class="hub-format-list">[\s\S]*?<\/ul>/);
  if (!actions) continue;
  for (const [kind, anchor] of [['listen', '#listen'], ['watch', '#watch']]) {
    const m = actions[0].match(new RegExp(`href="(/l/[^"]*)${anchor}"`));
    if (!m) continue;
    const page = join(DIST, m[1], 'index.html');
    if (!existsSync(page)) {
      errors.push(`/l/${lang.code}/ has a ${kind} control pointing at ${m[1]}, which was not built`);
      continue;
    }
    // The anchor is on the player itself, so its presence is the proof.
    if (!readFileSync(page, 'utf8').includes(`id="${kind === 'listen' ? 'listen' : 'watch'}"`)) {
      errors.push(`/l/${lang.code}/ offers ${kind} but ${m[1]} has no ${kind === 'listen' ? 'audio' : 'video'} player`);
    }
  }
}

// 4. Every link into the content tree must resolve. Check 3 covers the hubs;
// this covers every other page that links into /l/ — story prev/next above
// all, which steps through a list that has to be the pages this build made
// and not the snapshot's storyNums.
function* htmlFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* htmlFiles(p);
    else if (p.endsWith('.html')) yield p;
  }
}
let links = 0;
for (const file of htmlFiles(DIST)) {
  const from = file.slice(DIST.length);
  const seen = new Set();
  for (const m of readFileSync(file, 'utf8').matchAll(/href="(\/l\/[^"#?]*)/g)) {
    const path = m[1];
    if (!path.endsWith('/') || seen.has(path)) continue;
    seen.add(path);
    links++;
    if (!existsSync(join(DIST, path, 'index.html'))) errors.push(`${from} links ${path}, which was not built`);
  }
}

// 6. /llms.txt must list only URLs that 200 (#20). This is the whole point
// of the file: an index that advertises 214 language pages whose URLs 404 is
// worse than no index. Checked against the served file, not the source, so a
// generation bug cannot pass.
let llms = 0;
const llmsFile = join(DIST, 'llms.txt');
if (!existsSync(llmsFile)) {
  errors.push('llms.txt is missing');
} else {
  const text = readFileSync(llmsFile, 'utf8');
  for (const m of text.matchAll(new RegExp(`${SITE}(/[^\\s)]*)`, 'g'))) {
    const path = m[1].replace(/[.,]$/, '');
    llms++;
    // Directory routes are index.html; the markdown mirrors are plain files.
    const target = path.endsWith('/') ? join(DIST, path, 'index.html') : join(DIST, path);
    if (!existsSync(target)) errors.push(`llms.txt lists ${path}, which was not built`);
  }
  // Every mirror that exists must be listed, or the index is stale.
  const mirrors = existsSync(join(DIST, 'content'))
    ? readdirSync(join(DIST, 'content')).filter((f) => f.endsWith('.md'))
    : [];
  for (const f of mirrors) {
    if (!text.includes(`/content/${f}`)) errors.push(`llms.txt does not list /content/${f}`);
  }
}

// 7. The browser-side locale swap must be able to resolve every string.
//
// The hubs and story pages are one URL each, so their chrome is baked in one
// locale and swapped in the browser from /assets/i18n/{locale}.json (see
// public/assets/js/locale.js). The failure mode is silent and only visible to
// a visitor who prefers another language: a key that no longer exists leaves
// that one string in the baked language, and a whole page half-swapped reads
// as broken. So every key every page registers is checked against every
// bundle, here, where it costs nothing.
const bundleDir = join(DIST, 'assets/i18n');
let swapKeys = 0;
if (!existsSync(bundleDir)) {
  errors.push('assets/i18n/ is missing — the locale bundles were not built');
} else {
  const bundles = new Map();
  for (const f of readdirSync(bundleDir).filter((f) => f.endsWith('.json'))) {
    const b = JSON.parse(readFileSync(join(bundleDir, f), 'utf8'));
    if (!b.strings || !b.tag || !b.slugs) errors.push(`assets/i18n/${f} is missing strings, tag or slugs`);
    bundles.set(f.slice(0, -5), b);
  }
  if (bundles.size !== 16) errors.push(`${bundles.size} locale bundles built, expected 16`);
  const seen = new Set();
  for (const file of htmlFiles(DIST)) {
    const m = readFileSync(file, 'utf8').match(
      /<script type="application\/json" id="obs-chrome">([\s\S]*?)<\/script>/
    );
    if (!m) continue;
    let keys;
    try {
      keys = JSON.parse(m[1]).keys;
    } catch {
      errors.push(`${file.slice(DIST.length)}: the obs-chrome map is not valid JSON`);
      continue;
    }
    for (const entry of Object.values(keys ?? {})) {
      for (const key of [entry.k, ...Object.values(entry.r ?? {})]) {
        if (seen.has(key)) continue;
        seen.add(key);
        swapKeys++;
        for (const [locale, b] of bundles) {
          if (typeof b.strings[key] !== 'string') {
            errors.push(`chrome key "${key}" (from ${file.slice(DIST.length)}) is missing from assets/i18n/${locale}.json`);
          }
        }
      }
    }
  }
  if (!swapKeys) errors.push('no page registered any chrome strings — the locale swap would do nothing');
}

// 8. A placeholder is not a story.
//
// 14 published languages ship a repo whose story 1 says only "Video only" and
// links to a player. Those used to become real story pages, mirrors, sitemap
// URLs and CreativeWork nodes whose `text` was that sentence — see
// isStubContent() in fetch-catalog.mjs. This is the assertion that keeps them
// out, checked against the built HTML rather than the snapshot so a
// regression anywhere in the pipeline shows up.
const STUB = /video[\s-]*only/i;
let stubPages = 0;
for (const lang of languages) {
  const dir = join(DIST, 'l', lang.code);
  if (!existsSync(dir)) continue;
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory() || !/^story-\d+$/.test(d.name)) continue;
    const html = readFileSync(join(dir, d.name, 'index.html'), 'utf8');
    const h1 = html.match(/<h1[^>]*>([^<]*)<\/h1>/);
    if (h1 && STUB.test(h1[1])) {
      stubPages++;
      errors.push(`/l/${lang.code}/${d.name}/ publishes a placeholder as story text: "${h1[1].trim()}"`);
    }
  }
  // The hub must not quote it either — the extract is the "From story 1" block.
  const hub = readFileSync(join(dir, 'index.html'), 'utf8');
  const extract = hub.match(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/);
  if (extract && STUB.test(extract[1].replace(/<[^>]+>/g, ' '))) {
    errors.push(`/l/${lang.code}/ quotes a placeholder as its story-1 extract`);
  }
}

// 2b. Nothing may still reference the retired route.
function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}
const all = [...files(DIST)];
const stale = all.filter((f) => /\.(html|xml)$/.test(f) && readFileSync(f, 'utf8').includes('discover/read'));
if (stale.length) {
  errors.push(`${stale.length} file(s) still reference /discover/read/: ${stale.slice(0, 3).map((f) => f.slice(DIST.length)).join(', ')}`);
}

// 5. Cloudflare Pages refuses a deployment over 20,000 files.
if (all.length > MAX_FILES) {
  errors.push(`${all.length} files — over the Cloudflare Pages limit of ${MAX_FILES}.`);
}

if (errors.length) {
  for (const e of errors.slice(0, 12)) console.error(`✗ ${e}`);
  if (errors.length > 12) console.error(`  …and ${errors.length - 12} more`);
  process.exit(1);
}
console.log(
  `✓ routes OK — ${checked} sitemap URLs resolve, ${languages.length} hubs, ${builtStories} story pages, ` +
    `${links} links into /l/ resolve, ${llms} llms.txt URLs resolve, ${swapKeys} chrome keys swap in 16 locales, ` +
    `no placeholder story text, ` +
    `${all.length}/${MAX_FILES} files, no /discover/read/`
);
