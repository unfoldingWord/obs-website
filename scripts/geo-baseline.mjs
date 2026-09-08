// `npm run baseline` — generate the search / generative-visibility baseline
// sheet described in docs/search-visibility.md (#19).
//
// The point of generating it rather than typing it: the query and prompt set
// has to name each language the way people name it — autonym, English name,
// the older exonyms in the catalog's `altNames` — and those come from the
// same snapshot the pages are built from. A hand-typed sheet drifts from the
// site within a release or two, and drifts silently.
//
// What this CANNOT do is invent in-language query wording ("hadithi za
// biblia", "قصص الكتاب المقدس"). Those rows are for a speaker to add; the
// sheet carries a blank, clearly-marked row per language so the gap is
// visible instead of implied. See docs/native-review.md.
//
//   node scripts/geo-baseline.mjs                 # priority languages -> stdout
//   node scripts/geo-baseline.mjs --all           # every published language
//   node scripts/geo-baseline.mjs sw ha or        # named languages
//   node scripts/geo-baseline.mjs --out=baseline.csv
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SITE = 'https://openbiblestories.org';
const CATALOG = fileURLToPath(new URL('../src/data/catalog.json', import.meta.url));

/**
 * The languages to measure first. English plus five: the OBS languages with
 * the largest speaker populations that also have marketing locales, so a
 * result is interpretable (a hub in a language whose chrome is English is a
 * different experiment). Override by naming codes on the command line.
 */
const PRIORITY = ['en', 'sw', 'es-419', 'hi', 'ar', 'id'];

/** Where a query is asked. Search engines and answer engines are logged the
 *  same way so one sheet answers "are we findable at all". */
const SURFACES = ['Google', 'Bing', 'ChatGPT', 'Gemini', 'Perplexity', 'Copilot'];

const args = process.argv.slice(2);
const out = args.find((a) => a.startsWith('--out='))?.slice(6);
const all = args.includes('--all');
const named = args.filter((a) => !a.startsWith('--'));

if (!existsSync(CATALOG)) {
  console.error('src/data/catalog.json is missing — run `npm run fetch:catalog` first.');
  process.exit(1);
}
const { languages, fetchedDate } = JSON.parse(readFileSync(CATALOG, 'utf8'));
const wanted = all ? languages.map((l) => l.code) : named.length ? named : PRIORITY;
const missing = wanted.filter((c) => !languages.some((l) => l.code === c));
if (missing.length) {
  console.error(`not in the catalog: ${missing.join(', ')}`);
  process.exit(1);
}

const csv = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * The queries for one language. `kind` says what each row tests, because the
 * three fail differently: a brand query failing means the hub is not indexed
 * at all; a descriptive query failing means the hub does not read as "Bible
 * stories in X"; a format query failing means the PDF/audio is not
 * discoverable even though it exists.
 */
function queriesFor(lang) {
  const name = lang.englishName || lang.title;
  const autonym = lang.title && lang.title !== lang.code ? lang.title : null;
  const rows = [
    ['brand', `Open Bible Stories ${name}`],
    ['brand', `unfoldingWord Open Bible Stories ${name}`],
    ['descriptive', `Bible stories in ${name}`],
    ['descriptive', `${name} Bible story book children`],
  ];
  if (autonym && autonym !== name) {
    rows.push(['brand', `Open Bible Stories ${autonym}`]);
    rows.push(['descriptive', `Bible stories ${autonym}`]);
  }
  for (const alt of (lang.altNames || []).slice(0, 2)) {
    rows.push(['exonym', `Bible stories in ${alt}`]);
  }
  if (lang.formats?.pdf) rows.push(['format', `${name} Bible stories PDF download`]);
  if (lang.formats?.audio) rows.push(['format', `${name} audio Bible stories listen`]);
  if (lang.formats?.video) rows.push(['format', `${name} Bible stories video`]);
  // Prompts, not queries: the wording people give an answer engine.
  rows.push(['prompt', `Are there simple illustrated Bible stories in ${name}? Where can I download them?`]);
  rows.push(['prompt', `What is Open Bible Stories and is it available in ${name}?`]);
  // The row a speaker fills in. Never pre-filled with a machine translation:
  // a wrong phrase measured for a quarter is worse than a blank one.
  rows.push(['in-language (TO BE WRITTEN BY A SPEAKER)', '']);
  return rows;
}

const header = [
  'language_code', 'autonym', 'english_name', 'hub_url', 'kind', 'query_or_prompt',
  'surface', 'date_checked', 'obs_appears', 'position_or_cited', 'url_cited', 'notes',
];
const lines = [header.map(csv).join(',')];
for (const code of wanted) {
  const lang = languages.find((l) => l.code === code);
  for (const [kind, q] of queriesFor(lang)) {
    for (const surface of SURFACES) {
      lines.push([
        lang.code,
        lang.title,
        lang.englishName || '',
        `${SITE}/l/${encodeURIComponent(lang.code)}/`,
        kind,
        q,
        surface,
        '', '', '', '', '',
      ].map(csv).join(','));
    }
  }
}

const body = lines.join('\n') + '\n';
if (out) {
  writeFileSync(out, body);
  console.log(
    `wrote ${out} — ${lines.length - 1} rows, ${wanted.length} language(s), ${SURFACES.length} surfaces ` +
      `(catalog of ${fetchedDate || 'unknown date'}). Fill obs_appears / position_or_cited / url_cited by hand; ` +
      'see docs/search-visibility.md.'
  );
} else {
  process.stdout.write(body);
}
