// `npm test` — unit tests for the catalog build step. Runs offline against
// scripts/fixtures/catalog-entries.sample.json (a synthetic fixture in the
// shape of DCS catalog entries) and an in-memory fake `fetch`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  groupLanguages,
  applyLangnames,
  parseStoryMarkdown,
  makeExtract,
  detectScript,
  storyUrls,
  treeUrl,
  tsFramesFromTree,
  fetchTsFrames,
  parseTsFrame,
  fetchStories,
  enrichStories,
  compactAssets,
  chooseAutonym,
  scriptFor,
  scriptSample,
  assetFormats,
  fetchMissingAssets,
  enrichAssets,
  audioByStory,
  videoByStory,
  writeStoryFiles,
  mergeStoryMedia,
  clearReleasesCache,
  sortLanguages,
} from './fetch-catalog.mjs';

const entries = JSON.parse(readFileSync(new URL('./fixtures/catalog-entries.sample.json', import.meta.url), 'utf8'));
const languages = groupLanguages(entries);
const byCode = Object.fromEntries(languages.map((l) => [l.code, l]));

test('one record per language, sorted by title', () => {
  assert.deepEqual(languages.map((l) => l.code), ['en', 'sw', 'ar', 'zz'].sort((a, b) => byCode[a].title.localeCompare(byCode[b].title, 'en')));
  assert.equal(byCode.sw.entries.length, 2);
});

test('Theological Formation editions are excluded (same rule as discover.js)', () => {
  assert.equal(byCode.ha, undefined);
  assert.equal(languages.length, 4);
});

test('formats aggregate across teams; stream counts as video', () => {
  assert.deepEqual(byCode.sw.formats, { pdf: true, audio: false, video: true });
  assert.deepEqual(byCode.ar.formats, { pdf: false, audio: true, video: false });
  assert.deepEqual(byCode.en.formats, { pdf: true, audio: true, video: true });
});

test('direction and title fall back sensibly', () => {
  assert.equal(byCode.ar.direction, 'rtl');
  assert.equal(byCode.sw.direction, 'ltr');
  // No language_title in the fixture → the code stands in, nothing invented.
  assert.equal(byCode.zz.title, 'zz');
  assert.deepEqual(byCode.zz.formats, { pdf: false, audio: false, video: false });
});

test('entries keep only the fields the site reads, plus release date, content path and assets', () => {
  assert.deepEqual(
    Object.keys(byCode.en.entries[0]).sort(),
    ['assets', 'branch_or_tag_name', 'contentPath', 'metadata_type', 'name', 'owner', 'released', 'title']
  );
  assert.equal(byCode.en.entries[0].released, '2026-01-15');
  assert.equal(byCode.en.updated, '2026-01-15');
  assert.deepEqual(byCode.en.entries[0].assets, [{ name: 'en_obs.pdf', url: 'https://example.test/en_obs.pdf', size: 12345 }]);
});

test('compactAssets keeps only downloadable formats and YouTube links', () => {
  const assets = compactAssets({
    release: {
      assets: [
        { name: 'x.pdf', browser_download_url: 'https://e/x.pdf', size: 1 },
        { name: 'YouTube', browser_download_url: 'https://www.youtube.com/playlist?list=abc' },
        { name: 'source.usfm', browser_download_url: 'https://e/s.usfm' },
        { name: 'nourl.mp3' },
      ],
    },
  });
  assert.deepEqual(assets.map((a) => a.name), ['x.pdf', 'YouTube']);
  assert.equal(assets[1].size, null);
});

test('applyLangnames fills English name, alt names, region; catalog autonym wins', () => {
  const enriched = applyLangnames(languages, [
    { lc: 'sw', ln: 'Kiswahili', ang: 'Swahili', ld: 'ltr', lr: 'Africa', alt: ['Swahili', 'Kisuaheli', 'Kiswahili'], cc: ['TZ', 'KE'] },
    { lc: 'ZZ', ln: 'Zed', ang: 'Zed', ld: 'rtl', lr: 'Nowhere', alt: [], cc: [] },
  ]);
  const sw = enriched.find((l) => l.code === 'sw');
  assert.equal(sw.title, 'Kiswahili');
  assert.equal(sw.englishName, 'Swahili');
  assert.deepEqual(sw.altNames, ['Kisuaheli']);
  assert.equal(sw.region, 'Africa');
  assert.deepEqual(sw.countryCodes, ['TZ', 'KE']);
  const zz = enriched.find((l) => l.code === 'zz');
  assert.equal(zz.title, 'Zed', 'code-only title is replaced by the langnames autonym');
  assert.equal(zz.englishName, null, 'English name equal to the autonym is not repeated');
  assert.equal(zz.direction, 'rtl');
  assert.equal(enriched.find((l) => l.code === 'en').englishName, null, 'no row → unchanged');
});

test('chooseAutonym replaces English manifest titles with the langnames autonym', () => {
  const sw = { ln: 'Kiswahili', ang: 'Swahili' };
  assert.equal(chooseAutonym('Swahili', 'sw', sw), 'Kiswahili', 'title equals the English name');
  assert.equal(chooseAutonym('sw', 'sw', sw), 'Kiswahili', 'title equals the code');
  assert.equal(chooseAutonym('Kiswahili', 'sw', sw), 'Kiswahili', 'a real autonym stands');
  assert.equal(chooseAutonym('हिन्दी (Hindi)', 'hi', { ln: 'हिन्दी, हिंदी', ang: 'Hindi' }), 'हिन्दी', 'English in parentheses → first ln segment');
  assert.equal(chooseAutonym('Chinese, Simplified', 'zh', { ln: '中文 (Zhōngwén), 汉语, 漢語', ang: 'Chinese' }), '中文 (Zhōngwén)', 'ASCII title, non-Latin ln');
  assert.equal(chooseAutonym('Español de Latinoamérica', 'es-419', { ln: 'Español Latin America', ang: 'Spanish (Latin America)' }), 'Español de Latinoamérica', 'manifest beats a worse ln');
  assert.equal(chooseAutonym('Arabic', 'ar', { ln: 'العربية', ang: 'Arabic' }), 'العربية');
  assert.equal(chooseAutonym('Awadhi', 'awa', { ln: '', ang: 'Awadhi' }), 'Awadhi', 'no ln → keep title');
});

test('applyLangnames sets englishName whenever it differs from the chosen autonym', () => {
  const langs = groupLanguages([
    { owner: 'o', name: 'sw_obs', branch_or_tag_name: 'v1', title: 'Open Bible Stories', language: 'sw', language_title: 'Swahili' },
    { owner: 'o', name: 'hi_obs', branch_or_tag_name: 'v1', title: 'Open Bible Stories', language: 'hi', language_title: 'हिन्दी (Hindi)' },
    { owner: 'o', name: 'zh_obs', branch_or_tag_name: 'v1', title: 'Open Bible Stories', language: 'zh', language_title: 'Chinese, Simplified' },
    { owner: 'o', name: 'es-419_obs', branch_or_tag_name: 'v1', title: 'Open Bible Stories', language: 'es-419', language_title: 'Español de Latinoamérica' },
  ]);
  const out = Object.fromEntries(applyLangnames(langs, [
    { lc: 'sw', ln: 'Kiswahili', ang: 'Swahili', alt: ['Swahili', 'Kisuaheli'] },
    { lc: 'hi', ln: 'हिन्दी, हिंदी', ang: 'Hindi', alt: [] },
    { lc: 'zh', ln: '中文 (Zhōngwén), 汉语, 漢語', ang: 'Chinese', alt: [] },
    { lc: 'es-419', ln: 'Español Latin America', ang: 'Spanish (Latin America)', alt: [] },
  ]).map((l) => [l.code, l]));
  assert.deepEqual([out.sw.title, out.sw.englishName, out.sw.altNames], ['Kiswahili', 'Swahili', ['Kisuaheli']]);
  assert.deepEqual([out.hi.title, out.hi.englishName], ['हिन्दी', 'Hindi']);
  assert.deepEqual([out.zh.title, out.zh.englishName], ['中文 (Zhōngwén)', 'Chinese']);
  assert.deepEqual([out['es-419'].title, out['es-419'].englishName], ['Español de Latinoamérica', 'Spanish (Latin America)']);
});

test('sortLanguages orders by English name so scripts do not decide position', () => {
  const out = sortLanguages([
    { code: 'ur', title: 'اردو', englishName: 'Urdu' },
    { code: 'sw', title: 'Kiswahili', englishName: 'Swahili' },
    { code: 'hi', title: 'हिन्दी', englishName: 'Hindi' },
    { code: 'zz', title: 'Aa', englishName: null },
  ]);
  assert.deepEqual(out.map((l) => l.code), ['zz', 'hi', 'sw', 'ur']);
});

test('scriptFor maps Urdu in Arabic script to the Nastaliq pack', () => {
  assert.equal(scriptFor('ur', 'یہ پہلی کہانی ہے'), 'nastaliq');
  assert.equal(scriptFor('ur-deva', 'यह पहली कहानी है'), 'devanagari');
  assert.equal(scriptFor('ar', 'هذه هي القصة الأولى'), 'arabic');
  assert.equal(scriptFor('sw', ''), 'latin');
});

test('fetchMissingAssets pulls an advertised PDF from the newest release that has one', async () => {
  clearReleasesCache();
  const entry = { owner: 'o', name: 'sw_obs', branch_or_tag_name: 'v3', assets: [] };
  const releases = JSON.stringify([
    { tag_name: 'v3', draft: false, published_at: '2026-03-01T00:00:00Z', assets: [] },
    { tag_name: 'v2', draft: false, published_at: '2026-02-01T00:00:00Z', assets: [{ name: 'sw_obs.pdf', browser_download_url: 'https://e/v2/sw_obs.pdf', size: 10 }] },
    { tag_name: 'v1', draft: false, published_at: '2026-01-01T00:00:00Z', assets: [{ name: 'sw_obs.pdf', browser_download_url: 'https://e/v1/sw_obs.pdf', size: 9 }, { name: 'sw_obs_audio.zip', browser_download_url: 'https://e/v1/audio.zip', size: 99 }] },
  ]);
  let calls = 0;
  const f = fakeFetch((url) => (url.endsWith('/releases') ? (calls++, releases) : null));
  const withPdf = await fetchMissingAssets(entry, { pdf: true, audio: false, video: false }, f);
  assert.deepEqual(withPdf, [{ name: 'sw_obs.pdf', url: 'https://e/v2/sw_obs.pdf', size: 10, tag: 'v2' }]);
  const both = await fetchMissingAssets(entry, { pdf: true, audio: true, video: true }, f);
  assert.deepEqual(both.map((a) => a.url), ['https://e/v2/sw_obs.pdf', 'https://e/v1/audio.zip'], 'video not found anywhere → nothing invented');
  const own = [{ name: 'x.pdf', url: 'https://e/x.pdf', size: 1 }];
  assert.equal(await fetchMissingAssets({ ...entry, assets: own }, { pdf: true, audio: false, video: false }, f), own, 'nothing missing → no lookup');
  // One releases request per repo per run: the second lookup for the same
  // owner/name is served from the cache (see clearReleasesCache).
  assert.equal(calls, 1);
  assert.deepEqual(assetFormats(both), { pdf: true, audio: true, video: false });
});

test('enrichAssets reuses cached assets for unchanged entries', async () => {
  clearReleasesCache();
  let calls = 0;
  const f = fakeFetch(() => { calls++; return '[]'; });
  const lang = { code: 'sw', formats: { pdf: true, audio: false, video: false }, entries: [{ owner: 'o', name: 'sw_obs', branch_or_tag_name: 'v1', released: '2026-01-01', assets: [] }] };
  const previous = { languages: [{ ...lang, entries: [{ ...lang.entries[0], assets: [{ name: 'c.pdf', url: 'https://e/c.pdf', size: 1 }] }] }] };
  const quiet = { log() {} };
  const reused = await enrichAssets([lang], previous, f, quiet);
  assert.equal(calls, 0);
  assert.equal(reused[0].entries[0].assets[0].name, 'c.pdf');
  await enrichAssets([lang], null, f, quiet);
  assert.equal(calls, 1);
});

const STORY_MD = `---\ntitle: x\n---\n# 1. The Creation\n\n![OBS Image](https://cdn.door43.org/obs/jpg/360px/obs-en-01-01.jpg)\n\nThis is how the beginning of everything happened. God created the universe and everything in it in six days.\n\n![OBS Image](https://cdn.door43.org/obs/jpg/360px/obs-en-01-02.jpg)\n\nGod spoke, and light appeared. He called the light day.\n\n_A Bible story from: Genesis 1-2_\n`;

test('parseStoryMarkdown separates title, paragraphs and reference', () => {
  const p = parseStoryMarkdown(STORY_MD);
  assert.equal(p.title, '1. The Creation');
  assert.equal(p.paragraphs.length, 2);
  assert.equal(p.reference, 'A Bible story from: Genesis 1-2');
});

test('makeExtract joins paragraphs up to the cap and never returns empty text', () => {
  const p = parseStoryMarkdown(STORY_MD);
  const e = makeExtract(p, 1000);
  assert.match(e.text, /^This is how.*day\.$/);
  const short = makeExtract(p, 60);
  assert.ok(short.text.length <= 60);
  assert.ok(short.text.endsWith('…'));
  assert.equal(makeExtract({ title: 't', paragraphs: [], reference: '' }), null);
});

test('detectScript picks the dominant block', () => {
  assert.equal(detectScript('Hii ndiyo hadithi ya kwanza'), 'latin');
  assert.equal(detectScript('هذه هي القصة الأولى'), 'arabic');
  assert.equal(detectScript('यह पहली कहानी है'), 'devanagari');
  assert.equal(detectScript('এটি প্রথম গল্প'), 'bengali');
  assert.equal(detectScript('ဒါက ပထမ ဇာတ်လမ်း'), 'myanmar');
  assert.equal(detectScript('这是第一个故事'), 'han');
  assert.equal(detectScript('Это первая история'), 'cyrillic');
  assert.equal(detectScript(''), 'latin');
});

// The scripts with no marketing locale. These 38 languages used to detect as
// `other` and shipped no font pack at all — real text from their hubs, so a
// regression here means their hubs go back to empty boxes.
test('detectScript covers the Indic, Lao and Ethiopic scripts the catalog publishes', () => {
  assert.equal(detectScript('ଏହିପରି ହେଲା । ଛ ଦିନରେ ପରମେଶ୍ୱର'), 'oriya');
  assert.equal(detectScript('આ રીતે સઘળાંની શરુઆત થઈ'), 'gujarati');
  assert.equal(detectScript('ਇਸ ਤਰ੍ਹਾਂ ਹਰ ਇੱਕ ਚੀਜ਼ ਦੀ ਸ਼ੁਰੂਆਤ ਹੋਈ'), 'gurmukhi');
  assert.equal(detectScript('தேவன் ஆதியிலே எல்லாவற்றையும் படைத்தார்'), 'tamil');
  assert.equal(detectScript('ఆదిలో దేవుడు ఈ విధంగా సమస్త సృష్టిని'), 'telugu');
  assert.equal(detectScript('ದೇವರು ಆದಿಯಲ್ಲಿ ಎಲ್ಲವನ್ನೂ ಹೀಗೆ ಉಂಟುಮಾಡಿದನು'), 'kannada');
  assert.equal(detectScript('ആദിയില്‍ ദൈവം ഇപ്രകാരമാണ്'), 'malayalam');
  assert.equal(detectScript('ນີ້ຄືຈຸດເລີ່ມຕົ້ນຂອງສັບພະສິ່ງທັງໝົດ'), 'lao');
  assert.equal(detectScript('ከዚህ ቀጥሎ የምንመለከተው እግዚአብሔር'), 'ethiopic');
});

// Danda (U+0964) sits in the Devanagari block but is shared punctuation
// across the Indic scripts. Counting it as Devanagari is what made short
// Odia samples — which use it heavily — detect as the wrong script.
test('detectScript ignores the shared Indic danda', () => {
  assert.equal(detectScript('ଛ ଦିନ ।।।।।।।।।।।।।।।।'), 'oriya');
});

test('scriptSample reads the extract and every story title', () => {
  const sample = scriptSample({
    extract: { title: 'ଶୀର୍ଷକ', text: 'ପାଠ୍ୟ', reference: null },
    stories: [{ num: 1, title: 'ଏକ' }, { num: 2, title: null }],
  });
  assert.equal(sample, 'ଶୀର୍ଷକ ପାଠ୍ୟ ଏକ');
  assert.equal(scriptSample({ extract: null, stories: null }), '');
});

test('storyUrls mirrors discover.js for RC and ts repos', () => {
  const rc = storyUrls({ owner: 'o', name: 'r', branch_or_tag_name: 'v1', metadata_type: 'rc', contentPath: 'content' }, 7);
  assert.equal(rc.rc, 'https://git.door43.org/o/r/raw/v1/content/07.md');
  const ts = storyUrls({ owner: 'o', name: 'r', branch_or_tag_name: 'v1', metadata_type: 'ts' }, 7);
  assert.equal(ts.title, 'https://git.door43.org/o/r/raw/v1/07/title.txt');
  assert.deepEqual(ts.frames, ['https://git.door43.org/o/r/raw/v1/07/01.txt', 'https://git.door43.org/o/r/raw/v1/07/02.txt']);
});

function fakeFetch(routes) {
  return async (url) => {
    const body = routes(url);
    if (body == null) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  };
}

test('fetchStories reads 50 RC stories, builds the extract and detects the script', async () => {
  const lang = { code: 'en', entries: [{ owner: 'o', name: 'en_obs', branch_or_tag_name: 'v1', metadata_type: 'rc', contentPath: 'content' }] };
  const f = fakeFetch((url) => {
    const m = url.match(/content\/(\d\d)\.md$/);
    if (!m) return null;
    return m[1] === '01' ? STORY_MD : `# ${parseInt(m[1], 10)}. Story ${m[1]}\n\ntext\n`;
  });
  const r = await fetchStories(lang, f);
  assert.equal(r.stories.length, 50);
  assert.equal(r.stories[0].title, '1. The Creation');
  assert.equal(r.stories[49].title, '50. Story 50');
  assert.match(r.extract.text, /^This is how/);
  assert.equal(r.script, 'latin');
});

test('fetchStories handles ts repos and missing files without throwing', async () => {
  const lang = { code: 'ar', entries: [{ owner: 'o', name: 'ar_obs', branch_or_tag_name: 'v1', metadata_type: 'ts' }] };
  const f = fakeFetch((url) => {
    if (url.endsWith('/01/title.txt')) return 'الخلق';
    if (url.endsWith('/01/01.txt')) return 'هذه هي القصة الأولى عن الخلق';
    if (url.endsWith('/01/reference.txt')) return 'تكوين ١-٢';
    return null;
  });
  const r = await fetchStories(lang, f);
  assert.equal(r.stories[0].title, 'الخلق');
  assert.equal(r.stories[1].title, null);
  assert.equal(r.extract.text, 'هذه هي القصة الأولى عن الخلق');
  assert.equal(r.extract.reference, 'تكوين ١-٢');
  assert.equal(r.script, 'arabic');
});

// ---------------------------------------------------------------------------
// Legacy translationStudio ingestion. 18 published languages are tS repos;
// before this path they had titles and no bodies, so no story pages, no
// sitemap entries and no markdown mirror.

test('tsFramesFromTree keeps only frame files, sorted, and merges pages', () => {
  const frames = tsFramesFromTree(
    {
      tree: [
        { path: 'manifest.json', type: 'blob' },
        { path: '01', type: 'tree' },
        { path: '01/02.txt', type: 'blob' },
        { path: '01/01.txt', type: 'blob' },
        { path: '01/title.txt', type: 'blob' },
        { path: '01/reference.txt', type: 'blob' },
        { path: '51/01.txt', type: 'blob' },
      ],
    },
    { tree: [{ path: '02/01.txt', type: 'blob' }] }
  );
  assert.deepEqual(frames.get(1), ['01/01.txt', '01/02.txt']);
  assert.deepEqual(frames.get(2), ['02/01.txt']);
  assert.equal(frames.has(51), false, 'story 51 does not exist');
  assert.equal(frames.size, 2);
});

test('parseTsFrame lifts the illustration out and collapses the text', () => {
  const f = parseTsFrame('![OBS Image](https://cdn.door43.org/obs/jpg/360px/obs-en-01-01.jpg)\nخدا  دنیا\nرا آفرید\n');
  assert.equal(f.image, 'https://cdn.door43.org/obs/jpg/360px/obs-en-01-01.jpg');
  assert.equal(f.text, 'خدا دنیا را آفرید');
  assert.equal(parseTsFrame(null), null);
  assert.equal(parseTsFrame('  ').text, '');
});

test('fetchTsFrames returns null when the tree listing cannot be read', async () => {
  const entry = { owner: 'o', name: 'azb_obs', branch_or_tag_name: 'v1', metadata_type: 'ts' };
  assert.equal(await fetchTsFrames(entry, fakeFetch(() => null)), null, '404');
  assert.equal(await fetchTsFrames(entry, fakeFetch(() => 'not json')), null, 'unparseable');
  assert.equal(await fetchTsFrames(entry, fakeFetch(() => '{"tree":[]}')), null, 'no frames');
});

test('treeUrl asks for the repo at its release ref', () => {
  const url = treeUrl({ owner: 'o', name: 'azb_obs', branch_or_tag_name: 'v1.2' }, 2);
  assert.equal(url, 'https://git.door43.org/api/v1/repos/o/azb_obs/git/trees/v1.2?recursive=true&per_page=1000&page=2');
});

// The behaviour the 18 legacy languages were missing: real bodies, so
// writeStoryFiles() gives them storyNums and the build gives them pages.
function tsRepo({ stories = 2, frames = 3 } = {}) {
  const tree = [{ path: 'manifest.json', type: 'blob' }];
  for (let n = 1; n <= stories; n++) {
    const nn = String(n).padStart(2, '0');
    tree.push({ path: `${nn}/title.txt`, type: 'blob' }, { path: `${nn}/reference.txt`, type: 'blob' });
    for (let f = 1; f <= frames; f++) tree.push({ path: `${nn}/${String(f).padStart(2, '0')}.txt`, type: 'blob' });
  }
  return fakeFetch((url) => {
    if (url.includes('/git/trees/')) return url.includes('page=1') ? JSON.stringify({ tree, truncated: false }) : null;
    const m = url.match(/\/raw\/v1\/(\d\d)\/(title|reference|\d\d)\.txt$/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    if (n > stories) return null;
    if (m[2] === 'title') return `${n}. آفرینش`;
    if (m[2] === 'reference') return 'آفرینش ۱-۲';
    return `![OBS Image](https://cdn.door43.org/obs/jpg/360px/obs-en-${m[1]}-${m[2]}.jpg)\nمتن قالب ${m[2]} داستان ${n}`;
  });
}

test('fetchStories reads full bodies from a ts repo', async () => {
  const lang = { code: 'azb', entries: [{ owner: 'o', name: 'azb_obs', branch_or_tag_name: 'v1', metadata_type: 'ts' }] };
  const r = await fetchStories(lang, tsRepo({ stories: 2, frames: 3 }));
  assert.equal(r.stories.length, 50);
  assert.equal(r.stories[0].title, '1. آفرینش');
  assert.equal(r.stories[0].body.frames.length, 3);
  assert.equal(r.stories[0].body.reference, 'آفرینش ۱-۲');
  assert.equal(r.stories[0].body.frames[0].image, 'https://cdn.door43.org/obs/jpg/360px/obs-en-01-01.jpg');
  assert.equal(r.stories[0].body.frames[2].text, 'متن قالب 03 داستان 1');
  assert.equal(r.stories[1].body.frames.length, 3, 'story 2 too');
  assert.equal(r.stories[2].title, null, 'story 3 is not in this repo');
  assert.equal(r.stories[2].body, null);
  assert.equal(r.script, 'arabic');
  assert.match(r.extract.text, /^متن قالب 01/);
});

test('ts languages get story pages once bodies exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'obs-ts-'));
  const lang = {
    code: 'azb',
    entries: [],
    stories: [
      { num: 1, title: '1. آفرینش', body: { reference: 'آفرینش ۱-۲', frames: [{ image: null, text: 'یک' }] } },
      { num: 2, title: '2. گناه', body: null },
    ],
  };
  assert.equal(writeStoryFiles([lang], dir), 1);
  assert.deepEqual(lang.storyNums, [1], 'only the story with a body gets a page');
  const file = JSON.parse(readFileSync(join(dir, 'azb.json'), 'utf8'));
  assert.equal(file.stories[0].frames[0].text, 'یک');
  assert.deepEqual(lang.stories, [{ num: 1, title: '1. آفرینش' }, { num: 2, title: '2. گناه' }]);
});

test('a ts repo with no tree listing keeps its titles and gains no pages', async () => {
  const lang = { code: 'azb', entries: [{ owner: 'o', name: 'azb_obs', branch_or_tag_name: 'v1', metadata_type: 'ts' }] };
  const f = fakeFetch((url) => {
    if (url.includes('/git/trees/')) return null;
    if (url.endsWith('/01/title.txt')) return '1. آفرینش';
    if (url.endsWith('/01/01.txt')) return 'خدا دنیا را آفرید';
    if (url.endsWith('/01/reference.txt')) return 'آفرینش ۱-۲';
    return null;
  });
  const r = await fetchStories(lang, f);
  assert.equal(r.stories[0].title, '1. آفرینش');
  assert.equal(r.stories[0].body, null, 'two frames is an extract, not a story');
  assert.equal(r.extract.text, 'خدا دنیا را آفرید');
});

test('fetchStories falls through to the next team when the first repo has no stories', async () => {
  const lang = {
    code: 'awa',
    entries: [
      { owner: 'a', name: 'awa_obs', branch_or_tag_name: 'v1', metadata_type: 'rc', contentPath: 'content' },
      { owner: 'b', name: 'awa_obs', branch_or_tag_name: 'v2', metadata_type: 'rc', contentPath: 'content' },
    ],
  };
  const f = fakeFetch((url) => (url.startsWith('https://git.door43.org/b/') && url.endsWith('/01.md') ? STORY_MD : null));
  const r = await fetchStories(lang, f);
  assert.equal(r.stories[0].title, '1. The Creation');
  assert.equal(r.stories.filter((s) => s.title).length, 1, 'only stories that exist carry a title');
  const none = await fetchStories({ code: 'sgh', entries: [lang.entries[0]] }, f);
  assert.equal(none.stories, null);
  assert.equal(none.extract, null);
});

test('enrichStories reuses the previous snapshot when the release is unchanged', async (t) => {
  const { writeFileSync, rmSync } = await import('node:fs');

  const storiesDir = mkdtempSync(join(tmpdir(), 'obs-stories-'));
  t.after(() => rmSync(storiesDir, { recursive: true, force: true }));
  // Bodies live in src/data/stories/, so reuse requires that file to exist.
  writeFileSync(join(storiesDir, 'en.json'), JSON.stringify({ code: 'en', stories: [] }));
  let calls = 0;
  const f = fakeFetch((url) => {
    calls++;
    return url.endsWith('/01.md') ? STORY_MD : null;
  });
  const lang = { code: 'en', script: 'latin', entries: [{ owner: 'o', name: 'en_obs', branch_or_tag_name: 'v1', released: '2026-01-01', metadata_type: 'rc', contentPath: 'content' }] };
  const previous = { languages: [{ ...lang, stories: [{ num: 1, title: 'cached' }], extract: { title: 'c', text: 'cached', reference: null }, script: 'latin' }] };
  const quiet = { log() {} };
  const reused = await enrichStories([lang], previous, f, quiet, storiesDir);
  assert.equal(calls, 0);
  assert.equal(reused[0].stories[0].title, 'cached');
  const changed = { ...lang, entries: [{ ...lang.entries[0], branch_or_tag_name: 'v2' }] };
  const fresh = await enrichStories([changed], previous, f, quiet, storiesDir);
  assert.ok(calls > 0);
  assert.equal(fresh[0].stories[0].title, '1. The Creation');
});

// A cached record keeps its text but not its verdict about the script:
// widening detectScript() has to reach the ~200 languages that publish
// nothing new, or their font packs never arrive.
test('enrichStories re-derives the script of a reused record', async (t) => {
  const { writeFileSync, rmSync } = await import('node:fs');

  const storiesDir = mkdtempSync(join(tmpdir(), 'obs-stories-'));
  t.after(() => rmSync(storiesDir, { recursive: true, force: true }));
  writeFileSync(join(storiesDir, 'or.json'), JSON.stringify({ code: 'or', stories: [] }));
  const lang = { code: 'or', script: 'latin', entries: [{ owner: 'o', name: 'or_obs', branch_or_tag_name: 'v1', released: '2026-01-01', metadata_type: 'rc', contentPath: 'content' }] };
  const previous = {
    languages: [{
      ...lang,
      stories: [{ num: 1, title: 'ସୃଷ୍ଟି' }],
      extract: { title: 'ସୃଷ୍ଟି', text: 'ଏହିପରି ହେଲା ଛ ଦିନରେ ପରମେଶ୍ୱର', reference: null },
      // What the old detector wrote for this language.
      script: 'other',
    }],
  };
  const [out] = await enrichStories([lang], previous, fakeFetch(() => null), { log() {} }, storiesDir);
  assert.equal(out.script, 'oriya');
  assert.equal(out.stories[0].title, 'ସୃଷ୍ଟି');
});

test('parseStoryMarkdown pairs each illustration with the text that follows it', () => {
  const p = parseStoryMarkdown(STORY_MD);
  assert.equal(p.frames.length, 2);
  assert.equal(p.frames[0].image, 'https://cdn.door43.org/obs/jpg/360px/obs-en-01-01.jpg');
  assert.match(p.frames[0].text, /^This is how/);
  assert.equal(p.frames[1].text, 'God spoke, and light appeared. He called the light day.');
  assert.deepEqual(p.paragraphs, p.frames.map((f) => f.text), 'paragraphs stay in step with frames');
});

test('parseStoryMarkdown handles a titled image link and a frame with no image', () => {
  const p = parseStoryMarkdown('# T\n\n![a](https://cdn/x.jpg "caption")\n\nWith image.\n\nNo image.\n');
  assert.equal(p.frames[0].image, 'https://cdn/x.jpg');
  assert.equal(p.frames[1].image, null);
});

test('audioByStory takes the newest release with per-story mp3s, preferring bitrate', () => {
  const releases = [
    { tag_name: 'v6', assets: [
      { name: 'en_obs_v6_01_32kbps.mp3', browser_download_url: 'https://e/lo.mp3' },
      { name: 'en_obs_v6_01_128kbps.mp3', browser_download_url: 'https://e/hi.mp3' },
      { name: 'en_obs_v6_02_128kbps.mp3', browser_download_url: 'https://e/2.mp3' },
    ] },
    { tag_name: 'v1', assets: [{ name: 'en_obs_v1_01.mp3', browser_download_url: 'https://e/old.mp3' }] },
  ];
  const map = audioByStory(releases);
  assert.equal(map[1], 'https://e/hi.mp3', 'higher bitrate wins');
  assert.equal(map[2], 'https://e/2.mp3');
  assert.deepEqual(audioByStory([]), {});
  assert.deepEqual(audioByStory([{ assets: [{ name: 'whole_obs.zip', browser_download_url: 'https://e/z.zip' }] }]), {});
});

// Per-story video (#16): same numbering rule as the audio map, but the
// SMALLEST rendition wins — a story page is often opened on a phone on a
// slow connection, and the hub still links the full set.
test('videoByStory takes the newest release with per-story files, preferring the smallest rendition', () => {
  const releases = [
    { tag_name: 'v6', assets: [
      { name: 'en_obs_v6_01_720p.mp4', browser_download_url: 'https://e/big.mp4' },
      { name: 'en_obs_v6_01_360p.mp4', browser_download_url: 'https://e/small.mp4' },
      { name: 'en_obs_v6_02_360p.mp4', browser_download_url: 'https://e/2.mp4' },
      { name: 'en_obs_v6_all.zip', browser_download_url: 'https://e/all.zip' },
    ] },
    { tag_name: 'v1', assets: [{ name: 'en_obs_v1_01.3gp', browser_download_url: 'https://e/old.3gp' }] },
  ];
  const map = videoByStory(releases);
  assert.equal(map[1].url, 'https://e/small.mp4', 'smallest rendition wins');
  assert.equal(map[2].url, 'https://e/2.mp4');
  assert.equal(Object.keys(map).length, 2, 'the zip is not a per-story file');
  assert.deepEqual(videoByStory([]), {});
  // A YouTube playlist is not a per-story file and must not become one.
  assert.deepEqual(videoByStory([{ assets: [{ name: 'YouTube - Playlist', browser_download_url: 'https://www.youtube.com/playlist?list=X' }] }]), {});
});

// The video's own release date, not the language's newest release: a video is
// published once and the text revised repeatedly, and taking the language's
// `updated` rewrote the apparent upload date of an unchanged video every time.
test('videoByStory carries the publish date of the release the file came from', () => {
  const releases = [
    { tag_name: 'v9', published_at: '2023-03-03T00:00:00Z', assets: [{ name: 'en_obs_v9.pdf', browser_download_url: 'https://e/t.pdf' }] },
    { tag_name: 'v8', published_at: '2020-04-24T10:11:12Z', assets: [{ name: 'en_obs_v8_01_360p.mp4', browser_download_url: 'https://e/1.mp4' }] },
  ];
  const map = videoByStory(releases);
  assert.equal(map[1].date, '2020-04-24', 'the video release, not the newest text release');
  // No publish date on the release -> null, and the page omits the
  // VideoObject rather than inventing an uploadDate.
  const undated = videoByStory([{ assets: [{ name: 'x_obs_01_360p.mp4', browser_download_url: 'https://e/u.mp4' }] }]);
  assert.equal(undated[1].date, null);
});

test('writeStoryFiles splits bodies out and records storyNums', async (t) => {
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');

  const dir = mkdtempSync(join(tmpdir(), 'obs-stories-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const withBody = {
    code: 'sw',
    storyAudio: { 1: 'https://e/1.mp3' },
    storyVideo: { 1: { url: 'https://e/1.mp4', date: '2020-04-24' } },
    stories: [
      { num: 1, title: 'Uumbaji', body: { reference: 'Mwanzo 1-2', frames: [{ image: 'https://cdn/1.jpg', text: 'Hivi ndivyo' }] } },
      { num: 2, title: 'Dhambi', body: null },
    ],
  };
  const noBody = { code: 'zz', stories: [{ num: 1, title: 'T', body: null }] };

  const written = writeStoryFiles([withBody, noBody], dir);
  assert.equal(written, 1, 'only the language with bodies gets a file');
  assert.deepEqual(withBody.storyNums, [1], 'only stories with a body get a page');
  assert.deepEqual(noBody.storyNums, []);
  assert.deepEqual(withBody.stories, [{ num: 1, title: 'Uumbaji' }, { num: 2, title: 'Dhambi' }], 'hub list keeps every title');
  assert.ok(!('storyAudio' in withBody), 'audio map is not left on the snapshot');
  assert.ok(!('storyVideo' in withBody), 'video map is not left on the snapshot');

  const file = JSON.parse(readFileSync(join(dir, 'sw.json'), 'utf8'));
  assert.equal(file.stories[0].audio, 'https://e/1.mp3');
  assert.equal(file.stories[0].video, 'https://e/1.mp4');
  assert.equal(file.stories[0].videoDate, '2020-04-24');
  assert.equal(file.stories[0].reference, 'Mwanzo 1-2');
  assert.equal(file.stories[0].frames[0].image, 'https://cdn/1.jpg');
});

// Reproduces the reported defect: an existing checkout whose story text is
// reused from the snapshot never gained the video the release history had, so
// upgrading a built checkout showed no player and no VideoObject until the
// text release happened to change.
test('writeStoryFiles merges new media into a cached pre-video story file', async (t) => {
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');

  const dir = mkdtempSync(join(tmpdir(), 'obs-stories-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // A story file written before #16: no video field at all.
  writeFileSync(join(dir, 'en.json'), JSON.stringify({
    code: 'en',
    stories: [
      { num: 1, title: 'The Creation', reference: null, frames: [{ image: null, text: 'x' }], audio: null },
      { num: 2, title: 'Sin', reference: null, frames: [{ image: null, text: 'y' }], audio: null },
    ],
  }));

  // Text reused (no bodies on the record), media freshly fetched.
  const lang = {
    code: 'en',
    storyNums: [1, 2],
    storyAudio: { 1: 'https://e/1.mp3' },
    storyVideo: { 1: { url: 'https://example.com/01.mp4', date: '2020-04-24' } },
    stories: [{ num: 1, title: 'The Creation', body: null }, { num: 2, title: 'Sin', body: null }],
  };
  const written = writeStoryFiles([lang], dir);
  assert.equal(written, 0, 'no story file is rewritten from scratch');
  assert.deepEqual(lang.storyNums, [1, 2], 'the cached numbers survive');

  const file = JSON.parse(readFileSync(join(dir, 'en.json'), 'utf8'));
  assert.equal(file.stories[0].video, 'https://example.com/01.mp4');
  assert.equal(file.stories[0].videoDate, '2020-04-24');
  assert.equal(file.stories[0].audio, 'https://e/1.mp3');
  assert.equal(file.stories[1].video, undefined, 'a story with no media is untouched');
  assert.equal(file.stories[0].frames[0].text, 'x', 'the text is never rewritten');
});

test('mergeStoryMedia is a no-op with no media, no file, or unchanged media', async (t) => {
  const { mkdtempSync, writeFileSync, rmSync, statSync } = await import('node:fs');

  const dir = mkdtempSync(join(tmpdir(), 'obs-stories-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(mergeStoryMedia('nope', { 1: 'https://e/1.mp3' }, {}, dir), false, 'no story file');
  writeFileSync(join(dir, 'sw.json'), JSON.stringify({
    code: 'sw',
    stories: [{ num: 1, title: 'Uumbaji', frames: [], audio: 'https://e/1.mp3', video: 'https://e/1.mp4', videoDate: '2020-01-01' }],
  }));
  assert.equal(mergeStoryMedia('sw', {}, {}, dir), false, 'nothing discovered');
  assert.equal(
    mergeStoryMedia('sw', { 1: 'https://e/1.mp3' }, { 1: { url: 'https://e/1.mp4', date: '2020-01-01' } }, dir),
    false,
    'already current'
  );
  // A corrupt file keeps whatever it has instead of throwing.
  writeFileSync(join(dir, 'zz.json'), 'not json');
  assert.equal(mergeStoryMedia('zz', { 1: 'https://e/1.mp3' }, {}, dir), false);
  assert.ok(statSync(join(dir, 'zz.json')).size > 0);
});

test('writeStoryFiles keeps storyNums for a language reused from the snapshot', async (t) => {
  const { writeFileSync, rmSync } = await import('node:fs');

  const dir = mkdtempSync(join(tmpdir(), 'obs-stories-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'sw.json'), JSON.stringify({ code: 'sw', stories: [] }));

  // Cache hit: titles came back from the snapshot, bodies did not.
  const reused = { code: 'sw', storyNums: [1, 2, 3], stories: [{ num: 1, title: 'Uumbaji' }] };
  writeStoryFiles([reused], dir);
  assert.deepEqual(reused.storyNums, [1, 2, 3], 'existing pages are not dropped when bodies are cached');

  const orphan = { code: 'qq', storyNums: [1, 2], stories: [{ num: 1, title: 'x' }] };
  writeStoryFiles([orphan], dir);
  assert.deepEqual(orphan.storyNums, [], 'no file on disk → no story pages claimed');
});

test('enrichStories refetches when the cached entry has no story file on disk', async (t) => {
  const { mkdtempSync, rmSync } = await import('node:fs');

  const empty = mkdtempSync(join(tmpdir(), 'obs-stories-'));
  t.after(() => rmSync(empty, { recursive: true, force: true }));

  let calls = 0;
  const f = fakeFetch((url) => { calls++; return url.endsWith('/01.md') ? STORY_MD : null; });
  const lang = { code: 'en', script: 'latin', entries: [{ owner: 'o', name: 'en_obs', branch_or_tag_name: 'v1', released: '2026-01-01', metadata_type: 'rc', contentPath: 'content' }] };
  const previous = { languages: [{ ...lang, stories: [{ num: 1, title: 'cached' }], storyNums: [1], extract: null, script: 'latin' }] };
  await enrichStories([lang], previous, f, { log() {} }, empty);
  assert.ok(calls > 0, 'a gitignored story file that is gone must force a refetch');
});

