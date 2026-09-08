// Generate per-script webfont CSS into public/assets/fonts/ (adapted from
// churchbased.bible).
//
// The site self-hosts its fonts (no fonts.googleapis.com round trip, no IP
// disclosure to a host that is slow or blocked in parts of the world this
// site serves) — the committed montserrat/nunito-sans woff2 files cover
// latin + latin-ext only. Non-Latin locales (and Cyrillic for Russian) need
// more, but bundling every face would put hundreds of KB of @font-face
// rules on all 16 locales. Instead we emit one stylesheet per script and
// let Base.astro <link> only the one the current locale needs (see
// fontHrefFor() in src/i18n/config.ts).
//
// Run by `npm run dev` / `npm run build` (pre-scripts); the output
// (public/assets/fonts/*.css and public/assets/fonts/files/) is gitignored.
// The committed *.woff2 files in public/assets/fonts/ are NOT touched.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const OUT = join(ROOT, 'public/assets/fonts');
const FILES_OUT = join(OUT, 'files');

// script key -> fontsource packages + weights (+ optional subsets: use only
// those per-subset CSS files instead of the all-subset {weight}.css — the
// cyrillic pack must not re-declare the latin ranges the committed variable
// fonts already serve). Keys match the `script` field in src/i18n/config.ts
// (marketing locales), the values detectScript() can return in
// scripts/fetch-catalog.mjs (content languages), the packs listed by
// fontHrefForScript() in src/data/catalog.ts, and the
// html[data-script="…"] rules in public/assets/css/styles.css.
const PACKS = {
  arabic: [{ pkg: '@fontsource/noto-sans-arabic', weights: [400, 700] }],
  nastaliq: [{ pkg: '@fontsource/noto-nastaliq-urdu', weights: [400, 700] }],
  devanagari: [{ pkg: '@fontsource/noto-sans-devanagari', weights: [400, 700] }],
  bengali: [{ pkg: '@fontsource/noto-sans-bengali', weights: [400, 700] }],
  myanmar: [{ pkg: '@fontsource/noto-sans-myanmar', weights: [400, 700] }],
  han: [{ pkg: '@fontsource/noto-sans-sc', weights: [400, 700] }],
  // The scripts below carry no marketing locale — they exist because the
  // published translations do: 17 languages in Odia script, 14 in Gujarati,
  // and one each in Gurmukhi, Tamil, Telugu, Kannada, Malayalam, Lao and
  // Ethiopic. Without a pack their hubs and story pages rendered in
  // whatever the visitor's OS had, which for most of these is nothing.
  gurmukhi: [{ pkg: '@fontsource/noto-sans-gurmukhi', weights: [400, 700] }],
  gujarati: [{ pkg: '@fontsource/noto-sans-gujarati', weights: [400, 700] }],
  oriya: [{ pkg: '@fontsource/noto-sans-oriya', weights: [400, 700] }],
  tamil: [{ pkg: '@fontsource/noto-sans-tamil', weights: [400, 700] }],
  telugu: [{ pkg: '@fontsource/noto-sans-telugu', weights: [400, 700] }],
  kannada: [{ pkg: '@fontsource/noto-sans-kannada', weights: [400, 700] }],
  malayalam: [{ pkg: '@fontsource/noto-sans-malayalam', weights: [400, 700] }],
  lao: [{ pkg: '@fontsource/noto-sans-lao', weights: [400, 700] }],
  ethiopic: [{ pkg: '@fontsource/noto-sans-ethiopic', weights: [400, 700] }],
  cyrillic: [
    { pkg: '@fontsource/nunito-sans', weights: [400, 600, 700], subsets: ['cyrillic', 'cyrillic-ext'] },
    { pkg: '@fontsource/montserrat', weights: [700, 800, 900], subsets: ['cyrillic', 'cyrillic-ext'] },
  ],
};

// Clean only generated output; keep the committed woff2 files.
rmSync(FILES_OUT, { recursive: true, force: true });
for (const f of existsSync(OUT) ? readdirSync(OUT) : []) {
  if (f.endsWith('.css')) rmSync(join(OUT, f));
}
mkdirSync(FILES_OUT, { recursive: true });

const summary = [];
for (const [script, parts] of Object.entries(PACKS)) {
  let css = '';
  for (const { pkg, weights, subsets } of parts) {
    const pkgDir = join(ROOT, 'node_modules', pkg);
    for (const w of weights) {
      const candidates = subsets ? subsets.map((s) => `${s}-${w}.css`) : [`${w}.css`];
      for (const file of candidates) {
        const p = join(pkgDir, file);
        if (existsSync(p)) css += readFileSync(p, 'utf8') + '\n';
      }
    }
  }
  // Copy only the font files this CSS references, and point at their new home.
  const referenced = new Set();
  css = css.replace(/url\(\.\/files\/([^)]+)\)/g, (_, file) => {
    referenced.add(file);
    return `url(/assets/fonts/files/${file})`;
  });
  for (const { pkg } of parts) {
    const filesDir = join(ROOT, 'node_modules', pkg, 'files');
    for (const file of referenced) {
      const src = join(filesDir, file);
      if (existsSync(src)) copyFileSync(src, join(FILES_OUT, file));
    }
  }
  writeFileSync(join(OUT, `${script}.css`), css);
  summary.push(`${script}: ${referenced.size} file(s)`);
}
console.log('font packs built —', summary.join(', '));
