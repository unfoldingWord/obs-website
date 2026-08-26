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

## Structure

- `src/layouts/Base.astro` — the shared page shell: `<head>`, header/nav, footer, and the `nav.js` script tag. Nav highlighting comes from each page's `active` prop; the resources page uses the `navVariant="resources"` nav (different link order plus a Resources item).
- `src/pages/` — one `.astro` file per route (`src/pages/features/index.astro` → `/features/`). Each page passes its title/description to the layout and supplies only its `<main>` content, plus any per-page script tags via the named `scripts` slot.
- `public/` — copied to the site root verbatim at build time:
  - `assets/css/styles.css` — shared stylesheet.
  - `assets/js/` — small vanilla-JS behaviors (nav, tabs, discover filtering), loaded as plain script tags (`is:inline`), not bundled.
  - `assets/img/` — images and decorative SVGs.
  - `_redirects` / `_headers` — Cloudflare routing/caching rules (see below).

## Deployment

Deployed to **Cloudflare Pages** — project **`obs-website`** (`obs-web-cgw.pages.dev`), production branch `main`, via the Git integration.

Build settings: build command `npm run build`, output directory `dist` (also declared in `wrangler.jsonc` as `pages_build_output_dir`).

Current `_redirects` / `_headers` rules:
- `/library/*` and `/create/library/*` redirect (301) to `/discover/` — the old Library browser was retired in favor of Discover, which now covers search, format filters, and the inline reader.
- `/assets/img/*` is cached for 1 year (`immutable`) since filenames don't change.
- `/assets/js/*` and `/assets/css/*` use `no-cache` (always revalidate) since these are served in place under the same filenames — no content hashing.
