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
- **Sixteen packs, not seven.** The marketing locales need arabic, nastaliq, devanagari, bengali, myanmar, han and cyrillic; the *content* languages also publish in Odia (17 languages), Gujarati (14), Gurmukhi, Tamil, Telugu, Kannada, Malayalam, Lao and Ethiopic. Those 38 languages used to detect as script `other` and linked no pack at all, so their hubs and story pages rendered in whatever face the visitor's OS had — for most of these scripts, empty boxes. `npm run check:scripts` fails when any published language has no pack, so the next new script gets noticed rather than shipped unreadable. Adding one means: a `@fontsource` package and a `PACKS` entry in `build-font-css.mjs`, an `html[data-script="…"]` rule in `styles.css`, the value in `FONT_PACKS` and the `script` union in `src/data/catalog.ts`, and the Unicode block in `detectScript()` in `fetch-catalog.mjs`.
- The legal pages (`/license/`, `/privacy/`, `/terms-of-use/`) and the 404 page are English-only — no `/{lang}/` variants, no switcher.
- `/faq/` (and `/{lang}/faq/`) is a localized page like the others, with its strings in `faq.json`: eight questions whose answers open with the answer. It is linked from the **footer**, not the nav — the primary nav is the same five items in the same order on every page (WCAG 3.2.3 Consistent Navigation) — and it is in the sitemap and the 16-locale hreflang cluster like any other localized page.
- The Discover language list is prerendered at build time (see "Catalog data" below), ordered by English name so scripts do not decide position, with the English name as each row's secondary line and a `data-search` index (autonym, English name, alternate names, code) so "Swahili" finds Kiswahili. Each row is a plain link to that language's hub, so a click is an ordinary navigation. Its browse UI strings (status line, empty states) are localized via `browse.*` in `discover.json`, passed to `discover.js` as `data-*` attributes. Story pages take their labels from `story.json` and the hub's reader strings from `hub.json`; the reader's own chrome (story picker, slide controls) and the Resources browser (`resources.js`) are still English-only.
- `meta.title` / `meta.description` are per page and per locale. The homepage title is built from the localized tagline (`ui.siteTitle — home.hero.title`). Descriptions may contain `{count}`, which is replaced with the published-language count at build time.
- `npm run check:locales` — verifies every locale has every file, structure matches English, and embedded links are untouched; prints an untranslated ratio per locale.
- `npm run check:routes` — run after a build: every sitemap URL resolves to a built page, every hub links its story pages, every URL in `/llms.txt` was built (and every markdown mirror is listed), `/discover/read/` stays gone, and the output fits Cloudflare Pages' 20,000-file limit.
- `npm run check:scripts` — every published language has a font pack (see above).
- `npm run review -- --priority` — a review sheet per locale for a native reader: key, English source, current translation, a blank column, and flags for placeholders, embedded links and strings still identical to English. The hub/story/FAQ strings have had no native review; see `docs/native-review.md`.

## Catalog data and public facts

`scripts/fetch-catalog.mjs` runs before every dev/build (`npm run fetch:catalog` to run it alone) and writes `src/data/catalog.json`. `src/data/catalog.json` is meant to be **committed**: it is the offline fallback *and* the incremental cache for the story and release-asset lookups (a CI build with no snapshot re-fetches everything). Refresh it with `npm run fetch:catalog` and commit when the catalog has changed materially; the build refreshes it anyway. `src/data/catalog.ts` is the typed accessor. Four sources feed it:

1. **DCS catalog search** (required): every production-stage *Open Bible Stories* entry, grouped by language, minus the Theological Formation edition (paginating if the API truncates). Per entry: publisher, version tag, release date, and the downloadable release assets (PDF/EPUB/DOCX/zip/audio/video/YouTube).
2. **translationDatabase `langnames.json`** (optional): autonym, English name, alternate names, region, country codes, direction. The DCS manifest's `language_title` is often the English name ("Swahili", "Chinese, Simplified") or English in parentheses ("हिन्दी (Hindi)"); `chooseAutonym()` swaps in langnames' `ln` in those cases and keeps the manifest title otherwise (rule and cases in `fetch-catalog.test.mjs`).
3. **Release history** (optional): when the catalog advertises a PDF/audio/video the entry's own release does not carry (Door43-Catalog releases have no assets), the newest release of the repo that has it is used — the same resolution `discover.js` does at runtime. Cached per entry.
4. **Story text** (optional): the 50 story titles and a short extract of story 1 in the language, read straight from each repo (both Resource Container and legacy translationStudio layouts), trying each publishing team's entry until one yields stories. Results are cached in the snapshot and re-fetched only for entries whose release changed, so after the first build only what moved is fetched. `OBS_CATALOG_STORIES=0` skips this step for offline work.
5. **Per-story media** (optional): `audioByStory()` / `videoByStory()` read the release history for numbered per-story files (`en_obs_v6_23_360p.mp4`) and map them onto story numbers — the highest bitrate for audio, the *smallest* rendition for video, since a story page is often opened on a phone on a slow connection. The entry's own `assets` list is capped at 40 files and cannot hold a 50-story set, which is why this reads the releases directly; the releases lookup is cached per repo per run, so it adds no requests for entries whose assets were just fetched.

A language's `script` is re-derived from its text on every build, including when the record is reused from the snapshot cache — widening `detectScript()` has to reach the ~200 languages that will not publish a new release soon.

Everything public that states a fact about the languages reads from the snapshot:

- the language count on the homepage and Why OBS (`lang-count.js` only animates the served number; it no longer fetches anything),
- the prerendered language list on `/discover/` — each row links to the language's hub, and `discover.js` only filters those rows; it never fetches the catalog or changes the list (that would let it drift from the count),
- the `/l/{code}/` **language hubs** (see below), `sitemap-languages.xml`, and the JSON-LD on Discover and the hubs,
- `{count}` in localized meta descriptions.

So the public definition of "languages" is: **distinct language codes with a published OBS translation in the DCS catalog** — the same set Discover lists. Changing the catalog changes the number on the next build. `npm test` covers the grouping, langnames merge, story parsing, script detection and incremental story caching against `scripts/fixtures/catalog-entries.sample.json` (synthetic) and a fake `fetch`.

Failure policy: the snapshot is only overwritten by a complete, successful catalog fetch. `npm run build` fails only when the catalog fetch fails *and* no snapshot exists (Cloudflare then keeps the previous deployment live). Enrichment failures (langnames, a story file) never fail the build — the field falls back to the previous snapshot or null. `npm run dev` warns and writes an empty snapshot instead, and every page then states 0 languages — visibly wrong on purpose; there is no hardcoded placeholder count. `OBS_CATALOG_ALLOW_EMPTY=1` forces a build through offline.

## URL scheme

| URL | What it is |
| --- | --- |
| `/discover/`, `/{locale}/discover/` | Discovery only — the language list, search, format filters |
| `/l/{code}/` | The language page: names, codes, formats, downloads, story list, license |
| `/l/{code}/story-{n}/` | One story: full text, illustrations, audio and video when they exist |
| `/faq/`, `/{locale}/faq/` | Eight questions with short answers, in each of the 16 locales |
| `/llms.txt` | Index of the hubs and markdown mirrors, for fetchers that prefer markdown |
| `/content/{code}.md` | One language's complete story text as markdown |

A story is addressed the same way in both places: `/l/{code}/story-16/` as a page, `#story-16` as the reader's fragment. No title slug — one would either be English in every language's URLs or percent-encoded nonsense for non-Latin scripts, and it would move the URL whenever a translation was revised.

There is no `/discover/read/`. That route hosted the JS reader; the reader itself now lives on the language hub, and each story additionally has its own static page.

Two ways to read, deliberately, with one canonical URL each:

- **On the hub** — `/assets/js/reader.js` mounts in place when someone opens a story: slide-flip navigation, a story picker, per-story audio, YouTube where it exists, and a publisher chooser when several teams have published the language. It is not loaded on arrival — a hub is mostly visited for downloads or a single story, and mounting eagerly would fetch on all 214 hubs.

  It reads **this site's own copy** of the stories, `/l/{code}/stories.json` (`src/pages/l/[code]/stories.json.ts`) — the same text the story pages are built from. Reading one story used to cost a catalog lookup, a repo listing, 50 title fetches and a fetch per story viewed; it is now one same-origin request, and the reader keeps working when Door43 is unreachable. Per-story audio is in that bundle too, so the player does not wait on anything remote.

  Door43 is still consulted for two optional extras — the YouTube embed and the in-reader PDF link, which come from the repo's release history — and for a publisher the local text does not cover, since the build reads story text from one entry per language. Both fail quietly. When a build produced no story text at all (a Door43 outage), the endpoint is absent and the reader falls back to its original live-catalog path.
- **The story pages** — static HTML, one canonical URL per story, crawlable and readable with no JavaScript. Each story page has a "Read in the reader" link back to `/l/{code}/#story-N`.

Every "read" affordance on a hub — the Read online / Listen buttons, "Read this story" under the extract, and every row of the story list — has that story page as its `href`. `hub-reader.js` intercepts the click and opens the story in the reader instead. So crawlers follow real URLs, a visitor without JavaScript lands on a real page, and everyone else reads in place; the fragment is kept in step (`#story-N`) so the story stays shareable and Back works. Modified clicks (⌘/Ctrl/middle) are left alone, because opening a story in a new tab should give the story page.

This is not the sleight of hand removed from Discover: there the `href` pointed at a fragment that served no content, whereas here the `href` and the reader show the same story.

## Language hubs (`/l/{code}/`)

`src/pages/l/[code]/index.astro` renders one static page per published language — the canonical public URL for "Open Bible Stories in {language}". `/l/` keeps content languages out of the marketing-locale namespace (`/es/`, `/fr/`, …). Everything is in the initial HTML, ordered for a reader first: name (autonym as H1, or the English name when no autonym is known), then the actions — read online, listen (in the reader), watch, one primary PDF with its size, the full-audio zip with its size, EPUB/DOCX; the general mobile app is a note, not a per-language format — then the story-1 illustration with an in-language extract, the story titles that were actually read from the repo (usually all 50, never padded; a partial repo says `{n} of 50` and points to Translate), and at the foot an "About this translation" block with code, alternate names, region, publishers (version, date, their other PDFs) and the license. Every read link — the buttons and the story list — points at a story page and opens the reader on click (see "Two ways to read" above). A story whose title was read but whose text was not is shown without a link, so a link never lands on a page that was not built. `<html lang>`/`dir`, `data-script` and the font pack follow the content language (script detected from the fetched text; Urdu → Nastaliq); the chrome and labels come from `hubLocaleFor()` (see below) and `src/i18n/{lang}/hub.json`. A four-question FAQ sits above the "About" block — what this is, whether it is the whole Bible, what the license allows, how to help finish it — so "may I print this?" is answerable without opening `/license/`; it is visible text only, since 214 near-identical `FAQPage` nodes would be boilerplate. Those answers are in the hub's **chrome** language, which is the content language only for the 17 codes the site is published in; #17 also asks for a definition in the content language on every hub, and that criterion is deliberately still open (see `docs/native-review.md`). The first answer's story sentence is chosen from what the build can actually render — all 50, some, or none — so a hub with one translated story does not promise fifty. Hubs have a self-referencing canonical, no hreflang cluster, no locale switcher. Their JSON-LD is a `CreativeWork` (`inLanguage`, license, `isAccessibleForFree`, `translationOfWork`, publisher, `alternateName`, `dateModified`, PDF/EPUB/audio-zip `encoding`, the extract as `abstract`, `sameAs` the Door43 repos and the language's YouTube playlist) plus an `ItemList` of the readable stories. Still no `VideoObject` here: what most languages publish is a *playlist*, which is not one video and has neither a duration nor an upload date — per-story recordings are real media and carry `VideoObject` on the story pages.

**Which language the chrome is in** (`hubLocaleFor()` in `src/data/catalog.ts`): the same language when the code is one of the 16 marketing locales or an ISO 639-3 alias for one (`es-419` → es, `swh` → sw, `fas-x-eastfars` → fa); failing that, a locale in the **same script** — Hindi for the 88 Devanagari languages of India and Nepal, Bengali for the Bengali-script ones, Russian across Central Asia, Persian or Urdu for Arabic-script languages by country; failing that, English. Only 18 of 214 languages share a primary subtag with a marketing locale, so without the script step 196 hubs would show their FAQ, format labels and nav in English. Scripts with no marketing locale (Odia, Gujarati, Tamil, …) and Latin-script languages stay on English rather than guessing from a diaspora country list. The page's own text — H1, extract, story titles, story pages — is always in the content language whatever the chrome resolves to.

Standardized entity strings (also in `src/lib/jsonld.ts`):
- Product name: **unfoldingWord Open Bible Stories**
- License sentence: *Free to use, adapt, and share under CC BY-SA 4.0.*
- Canonical host: `https://openbiblestories.org` (www redirects to it).

## Story pages (`/l/{code}/story-{n}/`)

`src/pages/l/[code]/[story]/index.astro` renders one page per (language, story) that has full text — 9,062 of them at the last build, across 195 languages. Everything is in the initial HTML: the story title, every illustration paired with the paragraph it belongs to, the Bible reference, previous/next links and a link back to the hub. Where a release publishes per-story files, an `<audio>` and/or `<video>` element carries **that story's** recording, with a download link for it, and a line saying the text below is what the recording says, in the page's language — the per-story alternative to "all files zipped (7.2 GB)". Illustrations carry non-empty, language-appropriate alt (`{story} — illustration {n}`), because they carry the story and were never decorative. `<html lang>`/`dir`, `data-script` and the font pack follow the content language, exactly as on the hub; labels come from `src/i18n/{lang}/story.json`. Self-referencing canonical; hreflang alternates only for the site's own languages (see SEO plumbing). JSON-LD is one `CreativeWork` with the full `text`, `isPartOf` the hub's work, the first illustration as `image`, and `AudioObject`/`VideoObject` only where a real file exists — each carrying `transcript` (the page's own text, which is what lets a search engine index what the recording says); the `VideoObject` also needs `thumbnailUrl` and `uploadDate`, so it is emitted only where the illustration and the release date exist too.

Which stories have a page is `storyNums` on the catalog record intersected with the story text this build holds: the metadata says which stories a language has, `src/data/stories/{code}.json` says which of them the build can render. The hub's links, the story routes, prev/next and `sitemap-stories.xml` are all built from that same intersection, so a partial fetch cannot leave a link pointing at a page that was skipped; `npm run check:routes` proves it after every build, and also that every link into `/l/` resolves.

Story text is **not** in the committed snapshot. `scripts/fetch-catalog.mjs` writes one file per language into `src/data/stories/` (generated, gitignored, ~66MB); `src/data/stories.ts` loads them lazily so a story page pulls in only its own language. The build already downloads every story file to read its title, so keeping the body costs no extra requests — but it does mean a story file that is missing (a fresh clone, a cleaned checkout) forces that language to be re-fetched rather than reused from the snapshot cache.

## SEO plumbing

- `src/lib/jsonld.ts` builds one JSON-LD `@graph` per page (emitted by `Base.astro`): `Organization` (unfoldingWord) + `WebSite` with a `SearchAction` to `/discover/?q=` on every page; `CreativeWork` for the work on the homepage and Discover; an `ItemList` of translations pointing at the hubs on the English Discover page only; `hubNodes()` for each `/l/{code}/` page; `storyNodes()` (with media objects) for each story; `faqPageNode()` on the 16 `/faq/` pages, where the visible H2/answer text and the structured data are the same words. Media objects (`AudioObject`/`VideoObject`) are only emitted where a real file exists — never as empty placeholders. `sameAs` lists only URLs whose identity is confirmed: a wrong `sameAs` merges two entities in a knowledge graph. Candidates that could not be verified are parked in `docs/canonical-links.md` rather than shipped.
- hreflang: `Base.astro` emits the full reciprocal 16-locale set plus `x-default` (→ English) on every localized page. Legal pages, the 404 and the language hubs have no alternates.
- Sitemaps: `src/pages/sitemap-index.xml.ts` → `sitemap-pages.xml` (marketing pages with the same hreflang alternates as the HTML; no 404), `sitemap-languages.xml` (one hub per published language, `lastmod` from the latest release) and `sitemap-stories.xml` (one entry per story page). Generated by `src/lib/sitemap.ts`; `robots.txt` points at the index.
- **Story-level hreflang is narrowed, not absent.** A full cluster is impossible here: story N exists in ~214 languages, so linking every equivalent of every story is roughly 2.3M `<xhtml:link>` elements — gigabytes, past the 50MB per-sitemap limit. `sitemap-stories.xml` therefore clusters story N across the languages the site itself is published in (`siteLocaleOf()` — the 17 catalog codes that ARE one of the 16 marketing locales), and only where the story exists in two or more of them: at most 16 links on ~750 of the ~9,000 story URLs, self-referencing, reciprocal, `x-default` on the English story. Every other story URL gets none, which is correct rather than incomplete — a Hausa story has no reciprocal partner, and a one-sided cluster is worse than none.
- `/llms.txt` and `/content/{code}.md` (`src/lib/markdown.ts`) are a convenience layer for fetchers that prefer markdown — Google has said no special AI file is required, and the HTML remains canonical. The index lists every hub and, for each language whose full text this build holds, a mirror of all its stories; `check:routes` re-reads the served file and fails if any URL in it was not built, or if a mirror exists that it does not list. One file per **language**, not per story: `/content/{code}/{story}.md` would be another ~9,000 files on top of ~9,300 pages, and Cloudflare Pages refuses a deployment over 20,000 files.
- `og:locale` and `og:locale:alternate` are emitted per locale.

## Measurement, coordination and review

Three things this repository cannot finish on its own, each with the
generated part generated and the human part written down:

- `docs/search-visibility.md` — Search Console / Bing setup, what to watch,
  the quarterly generative-answer protocol, and where the tracker lives.
  `npm run baseline` writes the query and prompt sheet from the catalog
  (`--all`, `--out=FILE`, or named codes).
- `docs/canonical-links.md` — the off-repo checklist that makes
  openbiblestories.org the cited URL rather than Door43 or a mirror, plus the
  `sameAs` candidates waiting on verification.
- `docs/native-review.md` — the ask for a speaker of sw/es/hi/ar, and
  `npm run review -- --priority` to produce their sheet.

Two acceptance criteria elsewhere are also production checks rather than
code, and cannot be proven from a preview deployment (#11, #15):

```
curl -sI https://www.openbiblestories.org/library   # expect 301 -> apex /discover/
curl -sI https://openbiblestories.org/              # expect public, max-age=300, s-maxage=86400
curl -s  https://openbiblestories.org/robots.txt    # must not Disallow the retrieval agents
```

## Crawlers and AI policy

`public/robots.txt` allows all crawlers and additionally names the live-retrieval agents (OAI-SearchBot, ChatGPT-User, PerplexityBot, Perplexity-User, Claude-SearchBot, Claude-User, DuckAssistBot) in their own `Allow` groups. The **training** policy is set in the Cloudflare dashboard (managed robots.txt: `Content-Signal: search=yes, ai-train=no, use=reference` and `Disallow: /` for bulk training crawlers such as GPTBot, Google-Extended, ClaudeBot, CCBot); that is an intentional rights decision and lives there, not in this repo. The managed block list must not include the retrieval agents above, or the site drops out of live AI answers while `use=reference` says the opposite.

## Structure

- `src/layouts/Base.astro` — the shared page shell: `<head>` (including canonical/Open Graph/Twitter meta), skip link, header/nav, footer, and the `nav.js` script tag. Nav highlighting comes from each page's `active` prop. There is exactly one nav, in one order, on every page.
- `docs/` — the written half of the work that is not code: `search-visibility.md`, `canonical-links.md`, `native-review.md`.
- `src/pages/` — one `.astro` file per route (`src/pages/features/index.astro` → `/features/`). Each page passes its title/description to the layout and supplies only its `<main>` content, plus any per-page script tags via the named `scripts` slot. `src/pages/l/[code]/index.astro` generates the language hubs, `src/pages/l/[code]/[story]/index.astro` the story pages, `src/pages/sitemap-*.xml.ts` the sitemaps, and `src/pages/llms.txt.ts` / `src/pages/content/[code].md.ts` the markdown layer.
- `public/` — copied to the site root verbatim at build time:
  - `assets/css/styles.css` — shared stylesheet (includes the `@font-face` rules for the self-hosted fonts).
  - `assets/fonts/` — self-hosted variable woff2 files for Montserrat and Nunito Sans (latin + latin-ext), replacing the old render-blocking fonts.googleapis.com request.
  - `assets/js/` — small vanilla-JS behaviors (nav, tabs, discover filtering, the hub reader), loaded as plain script tags (`is:inline`), not bundled. `discover.js` only filters the prerendered rows and never touches the network; `reader.js` (mounted by `hub-reader.js`) is the one script that still calls Door43, and only on a hub, only once someone opens it.
  - `assets/img/` — images and decorative SVGs.
  - `_redirects` / `_headers` — Cloudflare routing/caching rules (see below); `_headers` also serves `/content/*` as `text/markdown; charset=utf-8`.
  - `robots.txt` — crawl policy (see "Crawlers and AI policy").

## Deployment

Deployed to **Cloudflare Pages** — project **`obs-website`** (`obs-web-cgw.pages.dev`), production branch `main`, via the Git integration.

Build settings: build command `npm run build`, output directory `dist` (also declared in `wrangler.jsonc` as `pages_build_output_dir`).

Current `_redirects` / `_headers` rules:
- `https://www.openbiblestories.org/*` 301s to the apex — requires both hostnames to be attached to the Pages project as custom domains (host-based rules only fire for attached domains).
- `/library`, `/library/*` and `/create/library/*` redirect (301) to `/discover/` — the old Library browser was retired in favor of Discover, which now covers search, format filters, and the inline reader. Legacy `#code--team` fragments survive the redirect, and `discover.js` forwards them to that language's hub (fragments never reach the server, so this has to happen client-side).
- `/features/*` redirects (301) to `/why-obs/` (renamed to match its nav label), and `/resources/*` redirects (301) to `/translate/#resources` (the standalone page was folded into the Translate page's Resources tab).
- HTML (`/*`): `public, max-age=300, s-maxage=86400, stale-while-revalidate=86400` — browsers revalidate after five minutes, the edge holds pages until the next deploy purges them. If public pages still come back `no-store` / `cf-cache-status: DYNAMIC`, a zone-level Cache Rule or Browser Cache TTL in the Cloudflare dashboard is overriding this file and must be changed there.
- `/assets/img/*` is cached for 1 year (`immutable`) since filenames don't change.
- `/assets/js/*` and `/assets/css/*` use `no-cache` (always revalidate in the browser) plus `s-maxage` at the edge, since these are served in place under the same filenames — no content hashing.
- `/assets/fonts/*` is cached for 1 year (`immutable`) like images.
