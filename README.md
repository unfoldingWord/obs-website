# Open Bible Stories — website

Static site for Open Bible Stories (unfoldingWord), built with [Astro](https://astro.build). Astro is used only for shared layouts — the output is plain HTML/CSS/JS with no client framework.

## Local development

```
npm install
npm run dev      # dev server at http://localhost:4321/
npm run build    # builds the site into dist/
npm run preview  # serves the built dist/
```

Requires Node 18.20+ (Astro's minimum).

## Localization

The site is localized into 16 languages — the same setup as churchbased.bible. English lives at `/`, every other locale at `/{lang}/` (e.g. `/es/translate/`). Locales: en, es, fr, hi, ru, ar, zh, sw, pt, id, vi, bn, ur, fa, my, nl — defined in `src/i18n/config.ts`.

- `src/i18n/en/*.json` — the English source strings, one file per page plus `ui.json` (nav, footer, shared strings).
- `src/i18n/{lang}/*.json` — translations. Missing keys fall back to English automatically (deep merge in `src/i18n/content.ts`), so a partially translated locale still renders completely.
- `src/components/pages/*.astro` — the page markup, one component per page, rendered once per locale; `src/pages/[lang]/` holds the non-English routes.
- `src/components/LanguageSwitcher.astro` — the language dropdown in the header.
- Non-Latin scripts (and Cyrillic) get self-hosted font packs, same policy as the Latin faces: `scripts/build-font-css.mjs` (run automatically before dev/build) emits one stylesheet per script into `public/assets/fonts/` from the `@fontsource` packages, and `Base.astro` links only the current page's pack (see `fontHrefFor()` in `src/i18n/config.ts`). The font-family overrides in `styles.css` are keyed on `<html data-script="…">`, which `Base.astro` sets from the locale's `script` (marketing pages) or the detected script of the content language (`/l/{code}/` hubs); ar/ur/fa render RTL.
- The legal pages (`/license/`, `/privacy/`, `/terms-of-use/`) and the 404 page are English-only — no `/{lang}/` variants, no switcher.
- The Discover language list is prerendered at build time (see "Catalog data" below), ordered by English name so scripts do not decide position, with the English name as each row's secondary line and a `data-search` index (autonym, English name, alternate names, code) so "Swahili" finds Kiswahili. Its browse UI strings (status line, empty and offline states, Back button) are localized via `browse.*` in `discover.json`, passed to `discover.js` as `data-*` attributes. The inline reader itself and the Resources browser (`resources.js`) are still English-only.
- `meta.title` / `meta.description` are per page and per locale. The homepage title is built from the localized tagline (`ui.siteTitle — home.hero.title`). Descriptions may contain `{count}`, which is replaced with the published-language count at build time.
- `npm run check:locales` — verifies every locale has every file, structure matches English, and embedded links are untouched; prints an untranslated ratio per locale.

## Catalog data and public facts

`scripts/fetch-catalog.mjs` runs before every dev/build (`npm run fetch:catalog` to run it alone) and writes `src/data/catalog.json`. `src/data/catalog.json` is meant to be **committed**: it is the offline fallback *and* the incremental cache for the story and release-asset lookups (a CI build with no snapshot re-fetches everything). Refresh it with `npm run fetch:catalog` and commit when the catalog has changed materially; the build refreshes it anyway. `src/data/catalog.ts` is the typed accessor. Four sources feed it:

1. **DCS catalog search** (required): every production-stage *Open Bible Stories* entry, grouped by language, minus the Theological Formation edition (paginating if the API truncates). Per entry: publisher, version tag, release date, and the downloadable release assets (PDF/EPUB/DOCX/zip/audio/video/YouTube).
2. **translationDatabase `langnames.json`** (optional): autonym, English name, alternate names, region, country codes, direction. The DCS manifest's `language_title` is often the English name ("Swahili", "Chinese, Simplified") or English in parentheses ("हिन्दी (Hindi)"); `chooseAutonym()` swaps in langnames' `ln` in those cases and keeps the manifest title otherwise (rule and cases in `fetch-catalog.test.mjs`).
3. **Release history** (optional): when the catalog advertises a PDF/audio/video the entry's own release does not carry (Door43-Catalog releases have no assets), the newest release of the repo that has it is used — the same resolution `discover.js` does at runtime. Cached per entry.
4. **Story text** (optional): the 50 story titles and a short extract of story 1 in the language, read straight from each repo (both Resource Container and legacy translationStudio layouts), trying each publishing team's entry until one yields stories. Results are cached in the snapshot and re-fetched only for entries whose release changed, so after the first build only what moved is fetched. `OBS_CATALOG_STORIES=0` skips this step for offline work.

Everything public that states a fact about the languages reads from the snapshot:

- the language count on the homepage and Why OBS (`lang-count.js` only animates the served number; it no longer fetches anything),
- the prerendered language list on `/discover/` — each row links to the language's hub; `discover.js` intercepts clicks to open the inline reader and never changes the list from the live catalog (that would let it drift from the count),
- the `/l/{code}/` **language hubs** (see below), `sitemap-languages.xml`, and the JSON-LD on Discover and the hubs,
- `{count}` in localized meta descriptions.

So the public definition of "languages" is: **distinct language codes with a published OBS translation in the DCS catalog** — the same set Discover lists. Changing the catalog changes the number on the next build. `npm test` covers the grouping, langnames merge, story parsing, script detection and incremental story caching against `scripts/fixtures/catalog-entries.sample.json` (synthetic) and a fake `fetch`.

Failure policy: the snapshot is only overwritten by a complete, successful catalog fetch. `npm run build` fails only when the catalog fetch fails *and* no snapshot exists (Cloudflare then keeps the previous deployment live). Enrichment failures (langnames, a story file) never fail the build — the field falls back to the previous snapshot or null. `npm run dev` warns and writes an empty snapshot instead, and every page then states 0 languages — visibly wrong on purpose; there is no hardcoded placeholder count. `OBS_CATALOG_ALLOW_EMPTY=1` forces a build through offline.

## Language hubs (`/l/{code}/`)

`src/pages/l/[code]/index.astro` renders one static page per published language — the canonical public URL for "Open Bible Stories in {language}". `/l/` keeps content languages out of the marketing-locale namespace (`/es/`, `/fr/`, …). Everything is in the initial HTML, ordered for a reader first: name (autonym as H1, or the English name when no autonym is known), then the actions — read online, listen (in the reader), watch, one primary PDF with its size, the full-audio zip with its size, EPUB/DOCX; the general mobile app is a note, not a per-language format — then the story-1 illustration with an in-language extract, the story titles that were actually read from the repo (usually all 50, never padded; a partial repo says `{n} of 50` and points to Translate), and at the foot an "About this translation" block with code, alternate names, region, publishers (version, date, their other PDFs) and the license. Story links open the full-page reader in the hub's UI locale (`/{ui}/discover/read/?lang={code}&story={n}`; story pages will replace these links); the reader's Back button returns to the hub, which works when Door43 does not. `<html lang>`/`dir`, `data-script` and the font pack follow the content language (script detected from the fetched text; Urdu → Nastaliq); the chrome and labels use the marketing locale with the same primary subtag and script, else English (`src/i18n/{lang}/hub.json`). Hubs have a self-referencing canonical, no hreflang cluster, no locale switcher. Their JSON-LD is a `CreativeWork` (`inLanguage`, license, `isAccessibleForFree`, `translationOfWork`, publisher, `alternateName`, `dateModified`, PDF/EPUB `encoding`, the extract as `abstract`) plus an `ItemList` of the readable stories. No `VideoObject` yet: Google requires `thumbnailUrl`/`uploadDate`, which arrive with media objects on story pages.

Standardized entity strings (also in `src/lib/jsonld.ts`):
- Product name: **unfoldingWord Open Bible Stories**
- License sentence: *Free to use, adapt, and share under CC BY-SA 4.0.*
- Canonical host: `https://openbiblestories.org` (www redirects to it).

## SEO plumbing

- `src/lib/jsonld.ts` builds one JSON-LD `@graph` per page (emitted by `Base.astro`): `Organization` (unfoldingWord) + `WebSite` with a `SearchAction` to `/discover/?q=` on every page; `CreativeWork` for the work on the homepage and Discover; an `ItemList` of translations pointing at the hubs on the English Discover page only; `hubNodes()` for each `/l/{code}/` page. Media objects (`AudioObject`/`VideoObject`) are only to be emitted where a real file exists — never as empty placeholders. `sameAs` lists only URLs that appear on the site; add YouTube / app-store / Wikidata links once confirmed.
- hreflang: `Base.astro` emits the full reciprocal 16-locale set plus `x-default` (→ English) on every localized page. Legal pages, the 404 and the language hubs have no alternates. Story-level clusters will come with story pages (sitemap method).
- Sitemaps: `src/pages/sitemap-index.xml.ts` → `sitemap-pages.xml` (marketing pages with the same hreflang alternates as the HTML; no 404) and `sitemap-languages.xml` (one hub per published language, `lastmod` from the latest release). Generated by `src/lib/sitemap.ts`; `robots.txt` points at the index. A stories sitemap will be added with story pages.
- `og:locale` and `og:locale:alternate` are emitted per locale.

## Crawlers and AI policy

`public/robots.txt` allows all crawlers and additionally names the live-retrieval agents (OAI-SearchBot, ChatGPT-User, PerplexityBot, Perplexity-User, Claude-SearchBot, Claude-User, DuckAssistBot) in their own `Allow` groups. The **training** policy is set in the Cloudflare dashboard (managed robots.txt: `Content-Signal: search=yes, ai-train=no, use=reference` and `Disallow: /` for bulk training crawlers such as GPTBot, Google-Extended, ClaudeBot, CCBot); that is an intentional rights decision and lives there, not in this repo. The managed block list must not include the retrieval agents above, or the site drops out of live AI answers while `use=reference` says the opposite.

## Structure

- `src/layouts/Base.astro` — the shared page shell: `<head>` (including canonical/Open Graph/Twitter meta), skip link, header/nav, footer, and the `nav.js` script tag. Nav highlighting comes from each page's `active` prop. There is exactly one nav, in one order, on every page.
- `src/pages/` — one `.astro` file per route (`src/pages/features/index.astro` → `/features/`). Each page passes its title/description to the layout and supplies only its `<main>` content, plus any per-page script tags via the named `scripts` slot. `src/pages/l/[code]/index.astro` generates the language hubs; `src/pages/sitemap-*.xml.ts` the sitemaps.
- `public/` — copied to the site root verbatim at build time:
  - `assets/css/styles.css` — shared stylesheet (includes the `@font-face` rules for the self-hosted fonts).
  - `assets/fonts/` — self-hosted variable woff2 files for Montserrat and Nunito Sans (latin + latin-ext), replacing the old render-blocking fonts.googleapis.com request.
  - `assets/js/` — small vanilla-JS behaviors (nav, tabs, discover filtering), loaded as plain script tags (`is:inline`), not bundled.
  - `assets/img/` — images and decorative SVGs.
  - `_redirects` / `_headers` — Cloudflare routing/caching rules (see below).

## Deployment

Deployed to **Cloudflare Pages** — project **`obs-website`** (`obs-web-cgw.pages.dev`), production branch `main`, via the Git integration.

Build settings: build command `npm run build`, output directory `dist` (also declared in `wrangler.jsonc` as `pages_build_output_dir`).

Current `_redirects` / `_headers` rules:
- `https://www.openbiblestories.org/*` 301s to the apex — requires both hostnames to be attached to the Pages project as custom domains (host-based rules only fire for attached domains).
- `/library`, `/library/*` and `/create/library/*` redirect (301) to `/discover/` — the old Library browser was retired in favor of Discover, which now covers search, format filters, and the inline reader. Legacy `#code--team` fragments survive the redirect and `discover.js` opens the language from the hash.
- `/features/*` redirects (301) to `/why-obs/` (renamed to match its nav label), and `/resources/*` redirects (301) to `/translate/#resources` (the standalone page was folded into the Translate page's Resources tab).
- HTML (`/*`): `public, max-age=300, s-maxage=86400, stale-while-revalidate=86400` — browsers revalidate after five minutes, the edge holds pages until the next deploy purges them. If public pages still come back `no-store` / `cf-cache-status: DYNAMIC`, a zone-level Cache Rule or Browser Cache TTL in the Cloudflare dashboard is overriding this file and must be changed there.
- `/assets/img/*` is cached for 1 year (`immutable`) since filenames don't change.
- `/assets/js/*` and `/assets/css/*` use `no-cache` (always revalidate in the browser) plus `s-maxage` at the edge, since these are served in place under the same filenames — no content hashing.
- `/assets/fonts/*` is cached for 1 year (`immutable`) like images.
