// `npm test` — unit tests for the catalog grouping used at build time.
// Runs offline against scripts/fixtures/catalog-entries.sample.json (a
// synthetic fixture in the shape of DCS catalog entries).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { groupLanguages } from './fetch-catalog.mjs';

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

test('entries keep only the fields the site reads', () => {
  assert.deepEqual(Object.keys(byCode.en.entries[0]).sort(), ['branch_or_tag_name', 'metadata_type', 'name', 'owner', 'title']);
});
