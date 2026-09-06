// `npm test` — unit tests for the catalog build step. Runs offline against
// scripts/fixtures/catalog-entries.sample.json (a synthetic fixture in the
// shape of DCS catalog entries) and an in-memory fake `fetch`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  assetFormats,
  fetchMissingAssets,
  enrichAssets,
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

test('scriptFor maps Urdu in Arabic script to the Nastaliq pack', () => {
  assert.equal(scriptFor('ur', 'یہ پہلی کہانی ہے'), 'nastaliq');
  assert.equal(scriptFor('ur-deva', 'यह पहली कहानी है'), 'devanagari');
  assert.equal(scriptFor('ar', 'هذه هي القصة الأولى'), 'arabic');
  assert.equal(scriptFor('sw', ''), 'latin');
});

test('fetchMissingAssets pulls an advertised PDF from the newest release that has one', async () => {
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
  assert.equal(calls, 2);
  assert.deepEqual(assetFormats(both), { pdf: true, audio: true, video: false });
});

test('enrichAssets reuses cached assets for unchanged entries', async () => {
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

test('enrichStories reuses the previous snapshot when the release is unchanged', async () => {
  let calls = 0;
  const f = fakeFetch((url) => {
    calls++;
    return url.endsWith('/01.md') ? STORY_MD : null;
  });
  const lang = { code: 'en', script: 'latin', entries: [{ owner: 'o', name: 'en_obs', branch_or_tag_name: 'v1', released: '2026-01-01', metadata_type: 'rc', contentPath: 'content' }] };
  const previous = { languages: [{ ...lang, stories: [{ num: 1, title: 'cached' }], extract: { title: 'c', text: 'cached', reference: null }, script: 'latin' }] };
  const quiet = { log() {} };
  const reused = await enrichStories([lang], previous, f, quiet);
  assert.equal(calls, 0);
  assert.equal(reused[0].stories[0].title, 'cached');
  const changed = { ...lang, entries: [{ ...lang.entries[0], branch_or_tag_name: 'v2' }] };
  const fresh = await enrichStories([changed], previous, f, quiet);
  assert.ok(calls > 0);
  assert.equal(fresh[0].stories[0].title, '1. The Creation');
});
