// Every published language must render in a real typeface.
//
// scripts/fetch-catalog.mjs detects each language's script from its own story
// text; Base.astro then <link>s the matching pack from public/assets/fonts/
// and styles.css keys the font-family override on <html data-script>. If a
// newly published translation uses a script we ship no pack for, the
// detector records `other`, the hub links no stylesheet, and the text renders
// in whatever face the visitor's OS happens to have — for most of these
// scripts, a row of empty boxes. That is invisible from an English desk, so
// it is a check rather than a comment.
//
// Run after the font build (both are pre-build steps): `npm run check:scripts`.
//
// Fixing a failure means, for each named script: add a @fontsource package
// and a PACKS entry in scripts/build-font-css.mjs, an html[data-script="…"]
// rule in public/assets/css/styles.css, the value in FONT_PACKS and the
// `script` union in src/data/catalog.ts, and the Unicode block in
// detectScript() in scripts/fetch-catalog.mjs.
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const snapshot = join(ROOT, 'src/data/catalog.json');

if (!existsSync(snapshot)) {
  console.error('✗ src/data/catalog.json is missing — run `npm run fetch:catalog` first.');
  process.exit(1);
}

const { languages = [] } = JSON.parse(readFileSync(snapshot, 'utf8'));
const byScript = new Map();
for (const l of languages) {
  if (!byScript.has(l.script)) byScript.set(l.script, []);
  byScript.get(l.script).push(l.code);
}

const problems = [];
for (const [script, codes] of [...byScript].sort()) {
  const sample = codes.slice(0, 6).join(', ') + (codes.length > 6 ? ', …' : '');
  if (script === 'other') {
    problems.push(`no font pack exists for the script of ${codes.length} language(s): ${sample}`);
    continue;
  }
  // The Latin faces are committed woff2 files loaded by styles.css itself.
  if (script === 'latin') continue;
  const css = join(ROOT, 'public/assets/fonts', `${script}.css`);
  if (!existsSync(css) || statSync(css).size === 0) {
    problems.push(`script "${script}" (${codes.length} language(s): ${sample}) has no /assets/fonts/${script}.css — is it in PACKS in scripts/build-font-css.mjs?`);
  }
}

if (problems.length) {
  console.error('✗ font packs incomplete:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const summary = [...byScript]
  .sort((a, b) => b[1].length - a[1].length)
  .map(([s, c]) => `${s} ${c.length}`)
  .join(', ');
console.log(`✓ scripts OK — every one of ${languages.length} languages has a font pack (${summary})`);
