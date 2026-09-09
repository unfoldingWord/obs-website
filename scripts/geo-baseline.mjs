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
// sheet carries six blank rows per language, each labelled with the intent
// it is for, so the gap is visible instead of implied — and so the sheet
// reaches the sample size #19 asks for once they are filled. See
// docs/native-review.md.
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

/**
 * What each blank in-language row is for. A speaker writes the phrase they
 * would really type or say for each of these; the generator never guesses
 * them. Keep this list and the ask in docs/search-visibility.md in step.
 */
const IN_LANGUAGE_INTENTS = [
  'Bible stories',
  'Bible stories PDF or printable',
  'listen to Bible stories',
  'Bible stories for children',
  'ask an assistant for Bible stories in this language',
  'the name people use for this language',
];

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
 * The rows for one language: 19-23 generated ones plus six blanks.
 *
 * `kind` says what each row tests, because they fail differently: a brand
 * query failing means the hub is not indexed at all; a descriptive query
 * failing means the hub does not read as "Bible stories in X"; a format query
 * failing means the PDF or audio exists and is undiscoverable; a prompt
 * failing means an answer engine will not name it.
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

  // Prompts, not queries: the wording people give an answer engine, which is
  // sentence-shaped and asks for a recommendation rather than a page. These
  // are the intents worth sampling, one prompt each — a dozen-plus DISTINCT
  // prompts per language, not two repeated across surfaces (asking the same
  // question of six engines is six observations of one prompt, and #19 asks
  // for a prompt sample, not an engine sample).
  const prompts = [
    `Are there simple illustrated Bible stories in ${name}? Where can I download them?`,
    `What is Open Bible Stories and is it available in ${name}?`,
    `I want to read Bible stories to children in ${name}. What is available for free?`,
    `Is there a free Bible story book in ${name} that my church can print?`,
    `What Bible resources exist in ${name}, and is any of them openly licensed?`,
    `Is Open Bible Stories in ${name} a Bible translation, or something else?`,
    `What is the difference between Open Bible Stories in ${name} and a full Bible in ${name}?`,
    `Which Open Bible Stories cover the life of Jesus, and are they available in ${name}?`,
    `May I record or adapt Open Bible Stories in ${name}? What does the license allow?`,
    `How would a church start translating Open Bible Stories into ${name}?`,
    `Who publishes Open Bible Stories in ${name}, and where does the text come from?`,
    `Is there Scripture content in ${name} for people who cannot read?`,
  ];
  if (lang.formats?.audio) prompts.push(`Where can I listen to Bible stories in ${name}?`);
  if (lang.formats?.video) prompts.push(`Where can I watch Bible story videos in ${name}?`);
  // Asked the way a speaker of the language would name it, not the way an
  // English catalog does.
  if (autonym && autonym !== name) prompts.push(`Where is the official page for Open Bible Stories in ${autonym}?`);
  for (const p of prompts) rows.push(['prompt', p]);
  // The rows a speaker fills in, one per intent, never pre-filled with a
  // machine translation: a wrong phrase measured for a quarter produces a
  // confident zero. Six blanks rather than one, because the generated rows
  // come to 20-24 per language and #19 asks for about 30 — the count and the
  // intents are spelled out in docs/search-visibility.md.
  for (const intent of IN_LANGUAGE_INTENTS) {
    rows.push([`in-language (TO BE WRITTEN BY A SPEAKER: ${intent})`, '']);
  }
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
