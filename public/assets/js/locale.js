(function () {
  // The visitor's interface language, as a preference rather than a property
  // of the URL they happened to arrive at.
  //
  // Three behaviours, one mechanism:
  //
  //   1. On first visit the interface language comes from the BROWSER
  //      (navigator.languages / Accept-Language), matched against the 16
  //      locales this site is published in. Someone in Jakarta opening
  //      openbiblestories.org gets Indonesian without hunting for a menu.
  //   2. A pick from the language switcher OVERRIDES that, and is remembered.
  //      An explicit choice outranks a browser setting, always.
  //   3. Choosing a CONTENT language — clicking a language on the Discover
  //      page — does not change the interface language. It used to: the hubs
  //      are one URL each and their chrome is baked in one locale at build
  //      time, so a visitor reading the site in Spanish who opened /l/bho/
  //      found the nav, buttons and FAQ in Hindi. Picking which translation
  //      to read is not a request to change the language you read the site
  //      in. So on those pages the chrome is swapped here instead, from
  //      /assets/i18n/{locale}.json.
  //
  // Everything this touches is chrome. Story text, story titles, autonyms and
  // the story-1 extract are the translation teams' work in the content
  // language and are never swapped — they are outside the marked regions.
  //
  // Without JavaScript nothing here runs and every page still serves the
  // language it was built in, which is why the baked locale stays the best
  // guess the build can make rather than always English.
  var KEY = 'obs.locale';
  var page = window.__obsLocale;
  if (!page || !page.locales || !page.locales.length) return;

  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return v && page.locales.indexOf(v) !== -1 ? v : null;
    } catch (e) {
      return null;
    }
  }

  function remember(code) {
    try {
      localStorage.setItem(KEY, code);
    } catch (e) {
      /* private mode, or site data blocked: the pick still applies to this page */
    }
  }

  // Match the browser's languages against the locales the site is published
  // in. An exact tag wins over a primary-subtag match ("pt-PT" prefers "pt"
  // over nothing), and the browser's own order is the priority order.
  function fromBrowser() {
    var wanted = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
    for (var i = 0; i < wanted.length; i++) {
      var tag = String(wanted[i] || '').toLowerCase();
      if (!tag) continue;
      for (var j = 0; j < page.locales.length; j++) {
        if (tag === String(page.tags[page.locales[j]] || '').toLowerCase()) return page.locales[j];
      }
      var primary = tag.split('-')[0];
      if (page.locales.indexOf(primary) !== -1) return primary;
      for (var k = 0; k < page.locales.length; k++) {
        if (String(page.tags[page.locales[k]] || '').toLowerCase().split('-')[0] === primary) return page.locales[k];
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // 2. Remember a switcher pick, on every page that has a switcher.
  // ---------------------------------------------------------------------
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[data-locale]');
    if (!a) return;
    var code = a.getAttribute('data-locale');
    remember(code);
    // On a locale-scoped page the link navigates to that page's own variant,
    // which is the right thing. On a single-URL page (a hub, a story) there
    // is nowhere to navigate TO, so the pick is applied in place instead —
    // and the href, which points at Discover in that language, stays as the
    // no-JavaScript fallback: a real destination in the language asked for,
    // rather than a dead self-link.
    if (!document.getElementById('obs-chrome')) return;
    e.preventDefault();
    swapTo(code);
    var menu = a.closest('.lang-switcher');
    if (menu) {
      var links = menu.querySelectorAll('a[data-locale]');
      for (var i = 0; i < links.length; i++) {
        if (links[i] === a) links[i].setAttribute('aria-current', 'true');
        else links[i].removeAttribute('aria-current');
      }
      var toggle = menu.querySelector('button[aria-haspopup]');
      if (toggle) {
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus();
      }
    }
  });

  var preferred = stored() || fromBrowser();
  if (!preferred) return;

  // Warm the bundle the hubs will need. A locale-scoped page never swaps —
  // it has its own copy in every locale — so it is the free place to fetch
  // the strings before the visitor reaches a hub or story page, where the
  // swap is on the critical path. Without this the first hub of a session
  // pays the full round trip.
  if (page.alternates) {
    var warm = document.createElement('link');
    warm.rel = 'prefetch';
    warm.as = 'fetch';
    warm.href = '/assets/i18n/' + preferred + '.json';
    warm.crossOrigin = 'anonymous';
    document.head.appendChild(warm);
  }

  if (preferred === page.locale) return;

  // ---------------------------------------------------------------------
  // 1. Locale-scoped pages: go to the same page in the preferred locale.
  //
  // Only ever FROM the default locale, which is the un-prefixed URL a bare
  // openbiblestories.org serves. A prefixed URL (/fr/discover/) is somebody's
  // explicit choice — a shared link, a switcher pick, a search result — and
  // is never redirected away from. The alternates are the page's own hreflang
  // cluster, so this cannot invent a URL that was not built.
  // ---------------------------------------------------------------------
  if (page.alternates && page.locale === page.defaultLocale) {
    var tag = page.tags[preferred];
    var link = tag && document.querySelector('link[rel="alternate"][hreflang="' + tag + '"]');
    if (link) {
      // hreflang hrefs are absolute and canonical (openbiblestories.org), so
      // take the PATH and stay on whatever origin the visitor is actually on
      // — a Pages preview deployment, or localhost.
      var to = new URL(link.getAttribute('href'), location.href).pathname + location.search + location.hash;
      if (to !== location.pathname + location.search + location.hash) {
        location.replace(to);
        return;
      }
    }
  }

  // ---------------------------------------------------------------------
  // 3. Single-URL pages (the hubs and story pages): swap the chrome.
  //
  // This script runs in <head> so the redirect above happens before the
  // browser paints a page the visitor is about to leave. The swap needs the
  // DOM, so it — and only it — waits. The bundle fetch does not: it can be in
  // flight while the document is still parsing.
  // ---------------------------------------------------------------------
  // Past this point a swap would land on a page the visitor is already
  // reading. Changing the language under someone mid-sentence — and, between
  // an LTR and an RTL locale, reflowing the layout — is worse than leaving
  // them in the language they started reading, which is a real language
  // chosen by hubLocaleFor() and not a broken state. So a bundle that arrives
  // late is dropped, and the preference applies from the next page instead
  // (by then it is cached, and the prefetch above usually means it already
  // is). Measured: on a fast connection the swap lands before first paint, so
  // this threshold is never reached.
  var LATE_MS = 1500;
  var started = Date.now();
  var fetching = fetch('/assets/i18n/' + preferred + '.json')
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .catch(function () {
      /* offline, or the bundle is missing: the page keeps its baked chrome */
      return null;
    });

  function chromeMap() {
    var el = document.getElementById('obs-chrome');
    if (!el) return null;
    try {
      var parsed = JSON.parse(el.textContent);
      return parsed && parsed.keys ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  // The page as built: every chrome text node and attribute, with the value
  // the build put there. Collected once, before anything is swapped, because
  // the swap has to be repeatable — a visitor can pick a third language from
  // the switcher, and after one swap the DOM no longer holds the baked text to
  // match on. Everything maps from here, never from the current DOM.
  var ATTRS = ['alt', 'title', 'aria-label', 'data-loading', 'data-offline', 'placeholder'];
  var bakedSlots = null;
  function collect() {
    if (bakedSlots) return bakedSlots;
    bakedSlots = { text: [], attrs: [], scopes: [] };
    var scopes = document.querySelectorAll('[data-i18n-scope]');
    for (var i = 0; i < scopes.length; i++) {
      var walker = document.createTreeWalker(scopes[i], NodeFilter.SHOW_TEXT, null);
      var node;
      while ((node = walker.nextNode())) {
        if (node.nodeValue.trim()) bakedSlots.text.push({ node: node, baked: node.nodeValue });
      }
      bakedSlots.scopes.push({
        el: scopes[i],
        lang: scopes[i].getAttribute('lang'),
        dir: scopes[i].getAttribute('dir'),
        inner: scopes[i].querySelectorAll('[data-i18n-lang]'),
      });
    }
    var all = document.querySelectorAll('[' + ATTRS.join('],[') + ']');
    for (var n = 0; n < all.length; n++) {
      for (var a = 0; a < ATTRS.length; a++) {
        var v = all[n].getAttribute(ATTRS[a]);
        if (v && v.trim()) bakedSlots.attrs.push({ el: all[n], attr: ATTRS[a], baked: v });
      }
    }
    return bakedSlots;
  }

  var bundles = {};
  function bundleFor(code) {
    if (bundles[code]) return bundles[code];
    bundles[code] = fetch('/assets/i18n/' + code + '.json')
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .catch(function () {
        return null;
      });
    return bundles[code];
  }
  bundles[preferred] = fetching;

  /** Render the chrome in `code`, from the baked page. */
  function swapTo(code) {
    var chrome = chromeMap();
    if (!chrome) return;
    collect();
    if (code === page.locale) {
      restore();
      return;
    }
    bundleFor(code).then(function (bundle) {
      if (bundle) apply(bundle, chrome);
    });
  }

  /** Back to exactly what the build produced. */
  function restore() {
    var slots = collect();
    for (var i = 0; i < slots.text.length; i++) slots.text[i].node.nodeValue = slots.text[i].baked;
    for (var a = 0; a < slots.attrs.length; a++) slots.attrs[a].el.setAttribute(slots.attrs[a].attr, slots.attrs[a].baked);
    for (var s = 0; s < slots.scopes.length; s++) {
      var sc = slots.scopes[s];
      if (sc.lang !== null) {
        sc.el.setAttribute('lang', sc.lang);
        sc.el.setAttribute('dir', sc.dir || 'ltr');
      }

      for (var j = 0; j < sc.inner.length; j++) {
        sc.inner[j].setAttribute('lang', sc.lang || page.tags[page.locale]);
        sc.inner[j].setAttribute('dir', sc.dir || 'ltr');
      }
    }
    var tagged = document.querySelectorAll('[data-i18n-script]');
    for (var c = 0; c < tagged.length; c++) tagged[c].removeAttribute('data-i18n-script');
    relocalizeLinks({ root: page.locale === page.defaultLocale ? '/' : '/' + page.locale + '/', slugs: page.slugs || {} });
  }

  function start() {
    if (!chromeMap()) return;
    fetching.then(function (bundle) {
      if (!bundle) return;
      // See LATE_MS: a swap that would land on a page the visitor is already
      // reading is dropped. A pick from the switcher is exempt — that one is
      // asked for, so it applies whenever it arrives.
      if (Date.now() - started > LATE_MS) return;
      swapTo(preferred);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  function fill(s, args) {
    if (!args) return s;
    for (var k in args) s = s.split('{' + k + '}').join(String(args[k]));
    return s;
  }

  function apply(bundle, chrome) {
    // What each baked string should become. `chrome.keys` maps the string as
    // it was RENDERED (placeholders already filled) to the key it came from
    // and the arguments it was filled with, so the same arguments go into the
    // preferred locale's wording — where they may sit in a different place in
    // the sentence.
    var swap = {};
    for (var rendered in chrome.keys) {
      var entry = chrome.keys[rendered];
      var target = bundle.strings[entry.k];
      if (typeof target !== 'string') continue;
      // `z` drops an optional "(...{size}...)" clause the page dropped too,
      // and `x` re-appends a part that was never translatable — a file size,
      // a version number.
      if (entry.z) target = target.replace(/\s*[（(][^)）]*\{size\}[^)）]*[)）]/, '');
      // An argument may itself be a chrome string (the hub FAQ embeds one of
      // three "how many stories" sentences), so resolve those first, in the
      // preferred locale and with the same arguments.
      var args = {};
      for (var key in entry.a || {}) args[key] = entry.a[key];
      for (var ref in entry.r || {}) {
        var nested = bundle.strings[entry.r[ref]];
        if (typeof nested !== 'string') { args = null; break; }
        args[ref] = fill(nested, entry.a);
      }
      if (!args) continue;
      var filled = fill(target, args) + (entry.x || '');
      if (filled && filled !== rendered) swap[rendered] = filled;
    }

    // Applied to the page AS BUILT, never to the current DOM: the visitor can
    // pick a third language from the switcher, and by then the DOM no longer
    // holds the baked text to match on. Content text — the autonym, the story
    // titles, the extract — is outside the marked regions and cannot be
    // reached from here even if it happened to read the same.
    var slots = collect();
    for (var i = 0; i < slots.text.length; i++) {
      var trimmed = slots.text[i].baked.trim();
      var to = swap[trimmed];
      slots.text[i].node.nodeValue = to ? slots.text[i].baked.replace(trimmed, to) : slots.text[i].baked;
      // The swapped script's face goes on the elements whose text actually
      // changed, and nowhere else. Putting it on the whole scope was wrong
      // twice over: a scope also wraps content-language text (the autonym
      // H1, the story titles), and the nav links inherit a font-family
      // computed on <body>, so a scope-level custom property never reached
      // them at all — swapped Arabic chrome rendered in whatever face the
      // content language uses, which for a Devanagari page has no Arabic
      // glyphs.
      var host = slots.text[i].node.parentElement;
      if (host) {
        if (to) host.setAttribute('data-i18n-script', bundle.script);
        else host.removeAttribute('data-i18n-script');
      }
    }

    // Attributes carry chrome too: an image's alt text, a button's accessible
    // name, the reader's loading and offline messages.
    for (var n = 0; n < slots.attrs.length; n++) {
      var slot = slots.attrs[n];
      var next = swap[slot.baked.trim()];
      slot.el.setAttribute(slot.attr, next || slot.baked);
    }

    relocalizeLinks(bundle);
    retag(bundle, slots.scopes);
  }

  // Nav and footer links must land in the new locale too, or the next click
  // undoes the swap. Each one carries its page slug; English-only pages (the
  // legal ones) have no slug and stay at the root.
  function relocalizeLinks(bundle) {
    var links = document.querySelectorAll('a[data-slug]');
    for (var i = 0; i < links.length; i++) {
      var slug = links[i].getAttribute('data-slug');
      var path = bundle.slugs[slug];
      if (path === undefined) continue;
      links[i].setAttribute('href', bundle.root + path);
    }
  }

  // The chrome's own language and direction, and the font pack its script
  // needs. <html lang>/dir stay on the CONTENT language: the page is still a
  // page about that translation, and the story text on it is still in it.
  function retag(bundle, scopes) {
    for (var i = 0; i < scopes.length; i++) {
      // Only where the build already declared the chrome language. A section
      // with no lang of its own wraps content that carries its own, and
      // stamping the chrome language over it would be a lie about the story
      // text inside.
      if (scopes[i].lang !== null) {
        scopes[i].el.setAttribute('lang', bundle.tag);
        scopes[i].el.setAttribute('dir', bundle.dir);
      }
      for (var j = 0; j < scopes[i].inner.length; j++) {
        scopes[i].inner[j].setAttribute('lang', bundle.tag);
        scopes[i].inner[j].setAttribute('dir', bundle.dir);
      }
    }
    if (bundle.fontHref && !document.querySelector('link[href="' + bundle.fontHref + '"]')) {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = bundle.fontHref;
      document.head.appendChild(link);
    }
    // <html data-script> is the CONTENT language's script and must not move
    // — the story text on the page is still written in it. The chrome regions
    // get [data-i18n-script] instead, which styles.css keys the same
    // --heading-font/--body-font custom properties on, so swapped Hindi or
    // Urdu chrome renders in a face that has its glyphs.

  }
})();
