# Open Bible Stories — website

Static site for Open Bible Stories (unfoldingWord). Plain HTML/CSS/JS, no build step — every page under a route folder (e.g. `features/index.html`) is already the built output.

## Local preview

```
python3 -m http.server 8080
# or: npx serve .
```

Then open `http://localhost:8080/`.

## Structure

- `index.html`, `features/`, `discover/`, `translate/`, `create/`, `resources/`, `contact/` — each a route.
- `assets/css/styles.css` — shared stylesheet.
- `assets/js/` — small vanilla-JS behaviors (nav, tabs, discover/library filtering). No bundler; these are edited directly under their current filenames.
- `assets/img/` — images and decorative SVGs.

## Deployment

Deployed to **Cloudflare Pages** — project **`obs-web`** (`obs-web-cgw.pages.dev`), production branch `main`.

Config files, all read automatically by Cloudflare:

- `wrangler.jsonc` — project name and `pages_build_output_dir: "."` (the repo root; there is no build step).
- `_redirects` / `_headers` — redirects and cache headers, in Cloudflare's plain-text format.
- `.assetsignore` — repo-only files (config, README) excluded from publishing.

Deploys are either direct uploads (`npx wrangler pages deploy .`) or, once the repo is connected under the project's Settings → Build → Git repository, automatic on every push to `main`. Leave the build command empty in either case.

Current rules:
- `/library/*` and `/create/library/*` redirect (301) to `/discover/` — the old Library browser was retired in favor of Discover, which now covers search, format filters, and the inline reader.
- `/assets/img/*` is cached for 1 year (`immutable`) since filenames don't change.
- `/assets/js/*` and `/assets/css/*` use `no-cache` (always revalidate) since these are edited in place under the same filenames — no content hashing/bundler here.
