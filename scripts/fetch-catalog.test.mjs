// `npm test` — unit tests for the catalog build step. Runs offline against
// scripts/fixtures/catalog-entries.sample.json (a synthetic fixture in the
// shape of DCS catalog entries) and an in-memory fake `fetch`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  groupLanguages,
  applyLangnames,
  parseStoryMarkdown,
  makeExtract,
  detectScript,
  storyUrls,
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
  writeStoryFiles,
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
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
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
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
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

test('writeStoryFiles splits bodies out and records storyNums', async (t) => {
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'obs-stories-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const withBody = {
    code: 'sw',
    storyAudio: { 1: 'https://e/1.mp3' },
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

  const file = JSON.parse(readFileSync(join(dir, 'sw.json'), 'utf8'));
  assert.equal(file.stories[0].audio, 'https://e/1.mp3');
  assert.equal(file.stories[0].reference, 'Mwanzo 1-2');
  assert.equal(file.stories[0].frames[0].image, 'https://cdn/1.jpg');
});

test('writeStoryFiles keeps storyNums for a language reused from the snapshot', async (t) => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
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
  const { tmpdir } = await import('node:os');
  const empty = mkdtempSync(join(tmpdir(), 'obs-stories-'));
  t.after(() => rmSync(empty, { recursive: true, force: true }));

  let calls = 0;
  const f = fakeFetch((url) => { calls++; return url.endsWith('/01.md') ? STORY_MD : null; });
  const lang = { code: 'en', script: 'latin', entries: [{ owner: 'o', name: 'en_obs', branch_or_tag_name: 'v1', released: '2026-01-01', metadata_type: 'rc', contentPath: 'content' }] };
  const previous = { languages: [{ ...lang, stories: [{ num: 1, title: 'cached' }], storyNums: [1], extract: null, script: 'latin' }] };
  await enrichStories([lang], previous, f, { log() {} }, empty);
  assert.ok(calls > 0, 'a gitignored story file that is gone must force a refetch');
});

