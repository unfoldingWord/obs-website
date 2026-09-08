// `npm run review -- sw` — a review sheet for one locale's strings (#21).
//
// The hub, story-page and FAQ strings were written without a native review.
// They are what a speaker of the language reads before they read a single
// word of the translation itself, and a phrase that is merely
// understandable — rather than what someone would actually say — is the
// difference between a page that looks translated and one that looks
// machine-translated. The remaining acceptance criterion on #21 is a person,
// not a commit; this makes the ask small enough to accept.
//
// Output is a markdown table per file: the key, the English source, the
// current translation, and an empty column to write in. Keys are flagged
// where they matter:
//
//   [placeholder] the string carries {language}/{n}/{count} — it must survive
//   [link]        the string carries an <a href>, which must survive verbatim
//   [same as EN]  untranslated, so probably missed rather than deliberate
//
//   node scripts/review-strings.mjs sw            # markdown to stdout
//   node scripts/review-strings.mjs sw --out=sw-review.md
//   node scripts/review-strings.mjs --priority    # the five #21 asks for
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// The files a reader of a language hub actually sees, in reading order.
const FILES = ['hub', 'story', 'faq', 'ui'];
// #21 asks for EN plus these four to be reviewed by a speaker or translator.
const PRIORITY = ['sw', 'es', 'hi', 'ar'];

const args = process.argv.slice(2);
const out = args.find((a) => a.startsWith('--out='))?.slice(6);
const locales = args.includes('--priority') ? PRIORITY : args.filter((a) => !a.startsWith('--'));

if (!locales.length) {
  console.error('usage: node scripts/review-strings.mjs <locale…> | --priority [--out=FILE]');
  process.exit(1);
}

/** Every string in a nested object, as [dotted.key, value]. */
function flatten(obj, prefix = '') {
  const rows = [];
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => rows.push(...flatten(v, `${prefix}[${i}]`)));
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) rows.push(...flatten(v, prefix ? `${prefix}.${k}` : k));
  } else if (typeof obj === 'string') {
    rows.push([prefix, obj]);
  }
  return rows;
}

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

const sections = [];
for (const locale of locales) {
  const lines = [`# Review sheet — \`${locale}\``, ''];
  lines.push(
    'Read the **Current** column as a speaker of the language, not against the English.',
    'Write what you would actually say in **Suggested**; leave it blank if the current',
    'wording is right. Anything marked `[placeholder]` must keep its `{…}` markers,',
    'and anything marked `[link]` must keep its `<a href="…">` exactly as it is.',
    ''
  );
  for (const page of FILES) {
    const enFile = join(ROOT, 'src/i18n/en', `${page}.json`);
    const locFile = join(ROOT, 'src/i18n', locale, `${page}.json`);
    if (!existsSync(locFile)) {
      console.error(`missing: src/i18n/${locale}/${page}.json`);
      process.exit(1);
    }
    const en = Object.fromEntries(flatten(JSON.parse(readFileSync(enFile, 'utf8'))));
    const loc = Object.fromEntries(flatten(JSON.parse(readFileSync(locFile, 'utf8'))));
    lines.push(`## ${page}.json`, '', '| Key | English | Current | Suggested |', '| --- | --- | --- | --- |');
    for (const [key, source] of Object.entries(en)) {
      const current = loc[key] ?? '';
      const flags = [];
      if (/\{[a-z]+\}/i.test(source)) flags.push('[placeholder]');
      if (/<a\s/i.test(source)) flags.push('[link]');
      if (current === source && /[a-z]{3,}/i.test(source)) flags.push('[same as EN]');
      lines.push(`| \`${key}\` ${flags.join(' ')} | ${cell(source)} | ${cell(current)} | |`);
    }
    lines.push('');
  }
  sections.push(lines.join('\n'));
}

const body = sections.join('\n---\n\n');
if (out) {
  writeFileSync(out, body);
  console.log(`wrote ${out} — ${locales.length} locale(s): ${locales.join(', ')}`);
} else {
  process.stdout.write(body);
}
