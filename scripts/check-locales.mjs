// Locale integrity check (adapted from churchbased.bible):
//  - every locale has every page file
//  - structure (keys, array lengths) matches English
//  - embedded HTML links/hrefs are untouched
//  - protected terms survive translation
//  - no HTML entities in the files rendered as plain text (see PLAIN_TEXT)
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const LOCALES = ['en', 'es', 'fr', 'hi', 'ru', 'ar', 'zh', 'sw', 'pt', 'id', 'vi', 'bn', 'ur', 'fa', 'my', 'nl'];
const PAGES = ['ui', 'home', 'why-obs', 'discover', 'translate', 'create', 'contact', 'faq', 'hub', 'story'];
// Keys whose values must be byte-identical to English (routing/link data).
const ASSET_KEYS = new Set(['slug', 'id']);
/**
 * Files whose strings are rendered as TEXT, not HTML: the hubs and story
 * pages print them through `{…}`, which escapes, so an `&mdash;` in one of
 * these shows up as the literal characters "&mdash;" on the page. It did, in
 * four locales' hub FAQ answers. Pages that use `set:html` (the marketing
 * copy, faq.json) may keep entities.
 */
const PLAIN_TEXT = new Set(['hub', 'story']);
const PRODUCT = 'Open Bible Stories';
// Link text of the Door43 community link, wherever it appears in a string.
const DOOR43_RE = /<a href=\\?"https:\/\/door43\.org\/\\?"[^>]*>([^<]*)<\/a>/;
const door43Name = (s) => String(s).match(DOOR43_RE)?.[1];
const ENTITY_RE = /&(?:[a-zA-Z][a-zA-Z0-9]{1,30}|#\d{1,6}|#x[0-9a-fA-F]{1,6});/;

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
    // Applies to English too: these files are printed escaped, in every
    // locale, so an entity is a literal "&mdash;" on the page.
    if (PLAIN_TEXT.has(page)) {
      (function entities(value, path) {
        if (typeof value === 'string') {
          const m = value.match(ENTITY_RE);
          if (m) err(`${locale}/${page} ${path}: HTML entity "${m[0]}" in a plain-text string — use the character itself`);
        } else if (Array.isArray(value)) value.forEach((v, i) => entities(v, `${path}[${i}]`));
        else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) entities(v, path ? `${path}.${k}` : k);
      })(data, '');
    }
    if (locale === 'en') continue;
    const base = JSON.parse(readFileSync(join(ROOT, 'src/i18n/en', `${page}.json`), 'utf8'));
    compare(locale, page, base, data, '');
    const all = JSON.stringify(data);
    if (/unfolding\s[Ww]ord/.test(all)) err(`${locale}/${page}: unfoldingWord split or miscased`);
    // The product name is never translated: wherever English says
    // "Open Bible Stories", the locale must carry it verbatim (#21 review).
    (function productName(b, l, path) {
      if (typeof b === 'string') {
        if (b.includes(PRODUCT) && typeof l === 'string' && !l.includes(PRODUCT))
          err(`${locale}/${page} ${path}: product name "${PRODUCT}" translated or missing`);
      } else if (Array.isArray(b)) b.forEach((v, i) => productName(v, l?.[i], `${path}[${i}]`));
      else if (b && typeof b === 'object') for (const k of Object.keys(b)) productName(b[k], l?.[k], `${path}.${k}`);
    })(base, data, '');
    // The Door43 community is named once in the footer (ui.json) and once in
    // the FAQ; the two must agree, or the site calls one body by two names.
    if (page === 'faq') {
      const footer = door43Name(JSON.parse(readFileSync(join(ROOT, 'src/i18n', locale, 'ui.json'), 'utf8')).footerCredit);
      const inFaq = JSON.stringify(data).match(DOOR43_RE)?.[1];
      if (footer && inFaq && footer !== inFaq) err(`${locale}/faq: Door43 community named "${inFaq}" but footer says "${footer}"`);
    }
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
