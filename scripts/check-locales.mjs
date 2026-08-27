// Locale integrity check (adapted from churchbased.bible):
//  - every locale has every page file
//  - structure (keys, array lengths) matches English
//  - embedded HTML links/hrefs are untouched
//  - protected terms survive translation
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const LOCALES = ['en', 'es', 'fr', 'hi', 'ru', 'ar', 'zh', 'sw', 'pt', 'id', 'vi', 'bn', 'ur', 'fa', 'my', 'nl'];
const PAGES = ['ui', 'home', 'why-obs', 'discover', 'discover-read', 'translate', 'create', 'contact'];
// Keys whose values must be byte-identical to English (routing/link data).
const ASSET_KEYS = new Set(['slug', 'id']);

let errors = 0;
const err = (m) => {
  console.error('ERROR', m);
  errors++;
};

/** hrefs embedded in HTML strings must survive translation verbatim. */
function hrefsOf(s) {
  return (String(s).match(/href="[^"]*"/g) || []).sort().join(' ');
}

function compare(locale, page, base, loc, path) {
  if (Array.isArray(base)) {
    if (!Array.isArray(loc) || loc.length !== base.length) {
      err(`${locale}/${page} ${path}: array length ${loc?.length} != ${base.length}`);
      return;
    }
    base.forEach((v, i) => compare(locale, page, v, loc[i], `${path}[${i}]`));
    return;
  }
  if (base && typeof base === 'object') {
    for (const k of Object.keys(base)) {
      if (!(k in (loc ?? {}))) {
        err(`${locale}/${page} ${path}.${k}: missing key`);
        continue;
      }
      if (ASSET_KEYS.has(k) && typeof base[k] === 'string') {
        if (loc[k] !== base[k]) err(`${locale}/${page} ${path}.${k}: routing value changed ("${loc[k]}" != "${base[k]}")`);
      } else if (typeof base[k] === 'string') {
        if (hrefsOf(base[k]) !== hrefsOf(loc[k])) err(`${locale}/${page} ${path}.${k}: embedded hrefs changed`);
      } else {
        compare(locale, page, base[k], loc[k], `${path}.${k}`);
      }
    }
    return;
  }
}

for (const locale of LOCALES) {
  for (const page of PAGES) {
    const f = join(ROOT, 'src/i18n', locale, `${page}.json`);
    if (!existsSync(f)) {
      err(`${locale}/${page}.json missing`);
      continue;
    }
    let data;
    try {
      data = JSON.parse(readFileSync(f, 'utf8'));
    } catch (e) {
      err(`${locale}/${page}.json invalid JSON: ${e.message}`);
      continue;
    }
    if (locale === 'en') continue;
    const base = JSON.parse(readFileSync(join(ROOT, 'src/i18n/en', `${page}.json`), 'utf8'));
    compare(locale, page, base, data, '');
    const all = JSON.stringify(data);
    if (/unfolding\s[Ww]ord/.test(all)) err(`${locale}/${page}: unfoldingWord split or miscased`);
    if (locale === 'bn' && /[ऀ-ॣ०-ॿ]/.test(all)) err(`bn/${page}: Devanagari characters in Bengali file`);
  }
}

// untranslated-ratio report (string-equal to English)
console.log('\nUntranslated ratio (identical to English):');
for (const locale of LOCALES.filter((l) => l !== 'en')) {
  let same = 0,
    total = 0;
  for (const page of PAGES) {
    const f = join(ROOT, 'src/i18n', locale, `${page}.json`);
    if (!existsSync(f)) continue;
    const base = JSON.parse(readFileSync(join(ROOT, 'src/i18n/en', `${page}.json`), 'utf8'));
    const loc = JSON.parse(readFileSync(f, 'utf8'));
    (function walk(b, l, path) {
      if (typeof b === 'string') {
        const key = path.split('.').pop()?.replace(/\[\d+\]$/, '');
        if (ASSET_KEYS.has(key) || !/[a-zA-Z]{3,}/.test(b)) return;
        total++;
        if (b === l) same++;
        return;
      }
      if (Array.isArray(b)) b.forEach((v, i) => walk(v, l?.[i], `${path}[${i}]`));
      else if (b && typeof b === 'object') for (const k of Object.keys(b)) walk(b[k], l?.[k], `${path}.${k}`);
    })(base, loc, page);
  }
  console.log(`  ${locale}: ${((same / total) * 100).toFixed(1)}% (${same}/${total})`);
}

console.log(errors ? `\n${errors} error(s)` : '\nAll locale checks passed.');
process.exit(errors ? 1 : 0);
