(function () {
  // Discover is a discovery surface and nothing else: search and format
  // filters over a language list that is already in the HTML.
  //
  // The list is prerendered at build time from the DCS catalog snapshot (see
  // src/data/catalog.ts). Each row is an <a class="lang-row"> pointing at
  // that language's hub (/l/{code}/) and carrying
  // data-lang/data-title/data-search/data-pdf/data-audio/data-video, so
  // browsing, searching and filtering all work with no network access at
  // all — and a click is an ordinary navigation, not an interception.
  //
  // Reading used to happen here, in a client-side reader that fetched the
  // live catalog and the story files. Stories are static pages now
  // (/l/{code}/{NN}-{slug}/), so that code is gone along with the catalog
  // fetch, its localStorage cache, and the offline/failure states they
  // needed. Nothing on this page talks to Door43 any more.
  const listEl = document.getElementById("lang-list");
  const statusEl = document.getElementById("lib-status");
  const searchEl = document.getElementById("lang-search");
  const browseEl = document.getElementById("lang-browse");
  const formatChips = document.querySelectorAll(".format-filters .filter-chip");

  if (!browseEl || !listEl || !searchEl || !statusEl) return;

  // Localized strings come from data-* attributes on #lang-browse, set from
  // src/i18n/{lang}/discover.json by DiscoverPage.astro.
  const browseStrings = browseEl.dataset || {};
  function str(key, fallback) {
    return browseStrings[key] || fallback;
  }

  let uniqueLanguages = [];
  let activeFormat = "all";

  function matchesSearch(langRow, query) {
    if (!query) return true;
    return langRow.search.includes(query.toLowerCase());
  }

  function matchesFormat(langRow, format) {
    if (format === "all") return true;
    return !!(langRow.formats && langRow.formats[format]);
  }

  // Read the prerendered rows once; filtering then just hides and shows them.
  function readPrerenderedList() {
    uniqueLanguages = Array.from(listEl.querySelectorAll(".lang-row")).map((row) => ({
      code: row.dataset.lang,
      title: row.dataset.title || row.dataset.lang,
      search: `${row.dataset.search || row.dataset.title || ""} ${row.dataset.lang}`.toLowerCase(),
      formats: {
        pdf: row.dataset.pdf === "1",
        audio: row.dataset.audio === "1",
        video: row.dataset.video === "1",
      },
      item: row.closest("li") || row,
    }));
  }

  function renderList() {
    const query = searchEl.value.trim();
    let shown = 0;
    uniqueLanguages.forEach((l) => {
      const visible = matchesSearch(l, query) && matchesFormat(l, activeFormat);
      l.item.hidden = !visible;
      if (visible) shown++;
    });

    if (shown === 0) {
      statusEl.textContent =
        activeFormat === "all"
          ? str("noMatch", "No languages match that search yet.")
          : str(
              "noMatchFormat",
              "No languages match that search and format yet — try a different format."
            );
      return;
    }

    statusEl.textContent = str("status", "{shown} of {total} published languages")
      .replace("{shown}", shown)
      .replace("{total}", uniqueLanguages.length);
  }

  // ---------- wiring ----------

  readPrerenderedList();

  // Legacy deep links. /discover/#sw opened a language inline here, and
  // /library/#kmz--fa_gl--kmz_obs_text (language code + team id) still 301s
  // to this page with its fragment intact. Fragments never reach the server,
  // so forwarding has to happen here. location.replace keeps the dead URL
  // out of the visitor's history.
  const legacyHash = decodeURIComponent(location.hash.replace("#", ""));
  if (legacyHash) {
    const separator = legacyHash.indexOf("--");
    const code = separator === -1 ? legacyHash : legacyHash.slice(0, separator);
    const row = Array.prototype.find.call(
      listEl.querySelectorAll(".lang-row"),
      (r) => r.dataset.lang === code
    );
    if (row) {
      location.replace(row.getAttribute("href"));
      return;
    }
  }

  // The WebSite SearchAction (JSON-LD in Base.astro) lands here with ?q=.
  const initialQuery = new URLSearchParams(window.location.search).get("q");
  if (initialQuery && !searchEl.value) searchEl.value = initialQuery;

  renderList();
  searchEl.addEventListener("input", renderList);

  formatChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      activeFormat = chip.dataset.format;
      formatChips.forEach((c) => {
        const isActive = c === chip;
        c.classList.toggle("active", isActive);
        c.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
      renderList();
    });
  });
})();
