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
    if (a) remember(a.getAttribute('data-locale'));
  });

  var preferred = stored() || fromBrowser();
  if (!preferred || preferred === page.locale) return;

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
  var fetching = fetch('/assets/i18n/' + preferred + '.json')
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .catch(function () {
      /* offline, or the bundle is missing: the page keeps its baked chrome */
      return null;
    });

  function start() {
    var baked = document.getElementById('obs-chrome');
    if (!baked) return;
    var chrome;
    try {
      chrome = JSON.parse(baked.textContent);
    } catch (e) {
      return;
    }
    if (!chrome || !chrome.keys) return;
    fetching.then(function (bundle) {
      if (bundle) apply(bundle, chrome);
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

    // Only inside the regions the page marked as chrome. Content text — the
    // autonym, the story titles, the extract — is outside them and cannot be
    // reached from here even if it happened to read the same.
    var scopes = document.querySelectorAll('[data-i18n-scope]');
    for (var i = 0; i < scopes.length; i++) swapText(scopes[i], swap);

    // Attributes carry chrome too: an image's alt text, a button's accessible
    // name, the reader's loading and offline messages.
    var attrs = ['alt', 'title', 'aria-label', 'data-loading', 'data-offline', 'placeholder'];
    var all = document.querySelectorAll('[' + attrs.join('],[') + ']');
    for (var n = 0; n < all.length; n++) {
      for (var a = 0; a < attrs.length; a++) {
        var v = all[n].getAttribute(attrs[a]);
        if (v && swap[v.trim()]) all[n].setAttribute(attrs[a], swap[v.trim()]);
      }
    }

    relocalizeLinks(bundle);
    retag(bundle, scopes);
  }

  function swapText(root, swap) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    var node;
    while ((node = walker.nextNode())) nodes.push(node);
    for (var i = 0; i < nodes.length; i++) {
      var text = nodes[i].nodeValue;
      var trimmed = text.trim();
      if (!trimmed) continue;
      var to = swap[trimmed];
      if (to) nodes[i].nodeValue = text.replace(trimmed, to);
    }
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
      if (scopes[i].hasAttribute('lang')) {
        scopes[i].setAttribute('lang', bundle.tag);
        scopes[i].setAttribute('dir', bundle.dir);
      }
      var inner = scopes[i].querySelectorAll('[data-i18n-lang]');
      for (var j = 0; j < inner.length; j++) {
        inner[j].setAttribute('lang', bundle.tag);
        inner[j].setAttribute('dir', bundle.dir);
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
    for (var s = 0; s < scopes.length; s++) scopes[s].setAttribute('data-i18n-script', bundle.script);
  }
})();
