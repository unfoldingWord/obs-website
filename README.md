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
- Non-Latin scripts (and Cyrillic) get self-hosted font packs, same policy as the Latin faces: `scripts/build-font-css.mjs` (run automatically before dev/build) emits one stylesheet per script into `public/assets/fonts/` from the `@fontsource` packages, and `Base.astro` links only the current locale's pack (see `fontHrefFor()` in `src/i18n/config.ts` and the `:lang()` rules at the end of `styles.css`); ar/ur/fa render RTL.
- The legal pages (`/license/`, `/privacy/`, `/terms-of-use/`) and the 404 page are English-only — no `/{lang}/` variants, no switcher.
- The Discover/Resources language browsers (`discover.js`, `resources.js`) are client-side apps whose dynamic UI strings are still English-only.
- `npm run check:locales` — verifies every locale has every file, structure matches English, and embedded links are untouched; prints an untranslated ratio per locale.

## Structure

- `src/layouts/Base.astro` — the shared page shell: `<head>` (including canonical/Open Graph/Twitter meta), skip link, header/nav, footer, and the `nav.js` script tag. Nav highlighting comes from each page's `active` prop. There is exactly one nav, in one order, on every page.
- `src/pages/` — one `.astro` file per route (`src/pages/features/index.astro` → `/features/`). Each page passes its title/description to the layout and supplies only its `<main>` content, plus any per-page script tags via the named `scripts` slot.
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
- `/library/*` and `/create/library/*` redirect (301) to `/discover/` — the old Library browser was retired in favor of Discover, which now covers search, format filters, and the inline reader.
- `/features/*` redirects (301) to `/why-obs/` (renamed to match its nav label), and `/resources/*` redirects (301) to `/translate/#resources` (the standalone page was folded into the Translate page's Resources tab).
- `/assets/img/*` is cached for 1 year (`immutable`) since filenames don't change.
- `/assets/js/*` and `/assets/css/*` use `no-cache` (always revalidate) since these are served in place under the same filenames — no content hashing.
- `/assets/fonts/*` is cached for 1 year (`immutable`) like images.
