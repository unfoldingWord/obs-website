// `npm run check:locale-swap` — click-through checks for the interface-language
// preference, in a real browser against the built site.
//
// Run after `npm run build`. Everything else in this repo is asserted against
// HTML on disk, which cannot see what public/assets/js/locale.js does: the
// hubs and story pages are one URL each, so a visitor who prefers another
// interface language has the chrome swapped in the browser, and the things
// that can go wrong there are behavioural — a redirect loop, a half-swapped
// page, story text swapped as if it were chrome, an <html lang> that stops
// matching the text under it.
//
// Needs `playwright-core` (a devDependency) and a Chromium build. It looks
// for one in CHROME_PATH, then PLAYWRIGHT_BROWSERS_PATH, then the usual
// system locations, and SKIPS rather than fails when there is none — CI
// without a browser should not turn red over a check it cannot run.
import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const PORT = Number(process.env.OBS_E2E_PORT || 4321);

if (!existsSync(DIST)) {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

function findChromium() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers'].filter(Boolean);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root)) {
      for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const p = join(root, dir, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
    if (existsSync(p)) return p;
  }
  return null;
}

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.log('- locale swap: playwright-core is not installed — skipped');
  process.exit(0);
}
const executablePath = findChromium();
if (!executablePath) {
  console.log('- locale swap: no Chromium found (set CHROME_PATH) — skipped');
  process.exit(0);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};
const server = createServer((req, res) => {
  let p = join(DIST, decodeURIComponent(req.url.split('?')[0]));
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!existsSync(p) || statSync(p).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found');
  }
  res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' });
  res.end(readFileSync(p));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}`;

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const failures = [];
const check = (name, pass, detail = '') => {
  if (!pass) failures.push(`${name}${detail ? ` — got: ${detail}` : ''}`);
  console.log(`  ${pass ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
};

/** A browser whose language list and stored preference we control. */
async function visitor({ languages = ['en-US'], preference = null } = {}) {
  const ctx = await browser.newContext({ locale: languages[0] });
  await ctx.addInitScript(([langs, pref]) => {
    Object.defineProperty(navigator, 'languages', { get: () => langs });
    Object.defineProperty(navigator, 'language', { get: () => langs[0] });
    if (pref) localStorage.setItem('obs.locale', pref);
  }, [languages, preference]);
  return ctx;
}
const path = (page) => new URL(page.url()).pathname;

// 1. The browser's own language chooses the interface language, once.
{
  const ctx = await visitor({ languages: ['es-MX', 'es'] });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  check('a Spanish browser opening / lands on /es/', path(page) === '/es/', path(page));

  const other = await ctx.newPage();
  await other.goto(`${BASE}/fr/`, { waitUntil: 'networkidle' });
  check('an explicit /fr/ URL is never redirected away from', path(other) === '/fr/', path(other));
  await ctx.close();
}

// 2. A language we do not publish leaves the page exactly as built.
{
  const ctx = await visitor({ languages: ['is-IS'] });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  check('an unsupported browser language leaves / alone', path(page) === '/', path(page));
  await ctx.close();
}

// 3. A switcher pick is an explicit choice: remembered, and it outranks the
//    browser setting from then on.
{
  const ctx = await visitor({ languages: ['fr-FR'] });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/fr/`, { waitUntil: 'networkidle' });
  await page.click('.lang-switcher-btn');
  await page.click('.lang-switcher-menu a[data-locale="sw"]');
  await page.waitForLoadState('networkidle');
  const stored = await page.evaluate(() => localStorage.getItem('obs.locale'));
  check('a switcher pick is remembered', stored === 'sw', String(stored));
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  check('the remembered pick beats the browser language', path(page) === '/sw/', path(page));
  await ctx.close();
}

// 4. The point of the swap: choosing a CONTENT language does not change the
//    interface language. /l/bho/ is built with Hindi chrome, because Bhojpuri
//    is not one of the 16 locales; a visitor reading the site in Spanish must
//    keep Spanish.
const hubs = readdirSync(join(DIST, 'l'));
const hub = hubs.includes('bho') ? 'bho' : hubs[0];
{
  const ctx = await visitor({ languages: ['es-MX'], preference: 'es' });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/l/${hub}/`, { waitUntil: 'networkidle' });
  await page
    .waitForFunction(() => document.querySelector('.site-nav')?.getAttribute('lang') === 'es-MX', null, { timeout: 5000 })
    .catch(() => {});
  const nav = await page.$$eval('.site-nav .links a', (as) => as.map((a) => a.textContent.trim()));
  const href = await page.$eval('.site-nav .links a[data-slug="discover"]', (a) => new URL(a.href).pathname);
  const html = await page.$eval('html', (e) => [e.getAttribute('lang'), e.getAttribute('data-script')]);
  const h1 = await page.$eval('h1', (e) => e.getAttribute('lang'));
  check('the hub nav swaps to the preferred locale', nav.includes('Descubre'), nav.join(' | '));
  check('nav hrefs follow the swap, so the next click stays there', href === '/es/discover/', href);
  check('<html lang> and data-script stay on the content language', html[0] === hub, JSON.stringify(html));
  check('the autonym H1 keeps the content language', h1 === hub, String(h1));
  await ctx.close();
}

// 5. Same on a story page, into an RTL locale, and the story text itself is
//    left alone — it is the translation team's work, not chrome.
{
  const codes = readdirSync(join(DIST, 'l')).filter((c) => existsSync(join(DIST, 'l', c, 'story-1')));
  if (!codes.length) {
    console.log('  - no story pages in this build — story checks skipped');
  } else {
    const code = codes.includes('en') ? 'en' : codes[0];
    const ctx = await visitor({ languages: ['ar-EG'], preference: 'ar' });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/l/${code}/story-1/`, { waitUntil: 'networkidle' });
    await page
      .waitForFunction(() => document.querySelector('.story-crumb')?.getAttribute('dir') === 'rtl', null, { timeout: 5000 })
      .catch(() => {});
    const crumb = await page.$eval('.story-crumb', (e) => [e.getAttribute('lang'), e.getAttribute('dir')]);
    const frames = await page.$eval('.story-frames', (e) => e.getAttribute('lang'));
    check('story chrome swaps and flips to RTL', crumb[0] === 'ar' && crumb[1] === 'rtl', JSON.stringify(crumb));
    check('the story text keeps its own language', frames === code, String(frames));
    await ctx.close();
  }
}

await browser.close();
server.close();

if (failures.length) {
  console.error(`\n✗ locale swap: ${failures.length} check(s) failed`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('✓ locale swap OK — browser language, switcher override, and no locale switch on a content page');
