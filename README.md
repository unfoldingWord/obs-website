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

Deployed as a static site. Two config files carry routing/caching rules and are read automatically by the respective host — keep both in sync if you add a redirect or change a cache policy:

- `netlify.toml` — Netlify redirects + headers.
- `_redirects` / `_headers` — the same rules in Cloudflare Pages' plain-text format.

Current rules:
- `/library/*` and `/create/library/*` redirect (301) to `/discover/` — the old Library browser was retired in favor of Discover, which now covers search, format filters, and the inline reader.
- `/assets/img/*` is cached for 1 year (`immutable`) since filenames don't change.
- `/assets/js/*` and `/assets/css/*` use `no-cache` (always revalidate) since these are edited in place under the same filenames — no content hashing/bundler here.

No build command is needed for either host: the publish/output directory is the repo root (`.`).
