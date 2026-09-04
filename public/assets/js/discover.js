(function () {
  // No `limit` param on purpose: omitting it returns every matching catalog
  // entry in one response per the DCS API docs, instead of silently capping
  // at 1000 and truncating the language list once the catalog grows past it.
  //
  // No `metadataType=rc` filter either: 16 languages only have an older "ts"
  // (translationStudio) format edition rather than Resource Container, and
  // excluding them was silently dropping real, readable translations. Both
  // formats are handled below (see isTsFormat and the ts-specific fetchers).
  const CATALOG_URL =
    "https://git.door43.org/api/v1/catalog/search?subject=Open%20Bible%20Stories&stage=prod";

  // ---------- catalog response caching ----------
  //
  // Measured directly against the live endpoint (repeated real requests,
  // Aug 2026): the server's own time-to-first-byte is ~2.2s regardless of
  // payload size or compression — it's backend query time, not something
  // fixable from here. What IS fixable: nothing was cached before, so every
  // single page view (including hitting back/reload on Discover) re-paid
  // that ~2.3s cost from scratch. This cache makes every visit inside the
  // TTL render instantly from localStorage instead.
  //
  // Also: the real response embeds a full `release` object per entry (every
  // downloadable asset, ~15KB) and a full Gitea `repo` metadata object
  // (~5.5KB of internal settings like merge policy and webhook flags) —
  // averaging ~20KB/entry across 245 entries, ~4MB total. Neither field is
  // read anywhere in this file (verified by grepping every entry.<field>
  // access below — the reader fetches its own release data separately, from
  // /repos/{owner}/{name}/releases, not from this embedded field), so only
  // the fields actually used are kept here. That drops the cached payload to
  // well under 1KB/entry with zero functional loss, and keeps localStorage
  // comfortably under browsers' ~5-10MB per-origin quota.
  const CATALOG_CACHE_KEY = "obs_discover_catalog_cache_v1";
  const CATALOG_CACHE_TTL_MS = 45 * 60 * 1000; // 45 minutes
  const CATALOG_ENTRY_FIELDS = [
    "owner",
    "name",
    "branch_or_tag_name",
    "title",
    "language",
    "language_title",
    "metadata_type",
    "attachment_types",
    "ingredients",
  ];

  function trimCatalogEntry(e) {
    const out = {};
    CATALOG_ENTRY_FIELDS.forEach((f) => {
      out[f] = e[f];
    });
    return out;
  }

  function readCatalogCache() {
    try {
      const raw = localStorage.getItem(CATALOG_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.entries) || typeof parsed.cachedAt !== "number") {
        return null;
      }
      if (Date.now() - parsed.cachedAt > CATALOG_CACHE_TTL_MS) return null;
      return parsed.entries;
    } catch (e) {
      return null; // storage disabled/corrupted (e.g. private browsing) — fall back to a live fetch
    }
  }

  function writeCatalogCache(entries) {
    try {
      localStorage.setItem(
        CATALOG_CACHE_KEY,
        JSON.stringify({ cachedAt: Date.now(), entries })
      );
    } catch (e) {
      // Quota exceeded or storage disabled — caching is a pure optimization,
      // so failing silently is correct: the visitor still gets a working
      // page, just without the speed-up on their next visit.
    }
  }

  const listEl = document.getElementById("lang-list");
  const statusEl = document.getElementById("lib-status");
  const searchEl = document.getElementById("lang-search");
  const detailEl = document.getElementById("lang-detail");
  const browseEl = document.getElementById("lang-browse");
  const formatChips = document.querySelectorAll(".format-filters .filter-chip");

  // Localized UI strings for the browse list come from data-* attributes on
  // #lang-browse (set from src/i18n/{lang}/discover.json by DiscoverPage.astro).
  // The reader itself is still English-only.
  const browseStrings = (browseEl && browseEl.dataset) || {};
  function str(key, fallback) {
    return browseStrings[key] || fallback;
  }

  let languageGroups = new Map();
  // The language list is prerendered into the HTML at build time from the DCS
  // catalog (see src/data/catalog.ts). Each row is an <a class="lang-row">
  // carrying data-lang/data-title/data-pdf/data-audio/data-video, so the list,
  // search and format filters work before (and without) the catalog fetch —
  // the fetch is only needed to open a language's reader.
  let uniqueLanguages = [];
  let activeFormat = "all";

  // Tracks the single arrow-key slide-flip handler currently attached to the
  // page, so a new reader instance (or leaving the reader entirely) can
  // clean up the previous one instead of stacking listeners. See setupReader.
  let activeReaderKeyHandler = null;
  function clearReaderKeyHandler() {
    if (activeReaderKeyHandler) {
      document.removeEventListener("keydown", activeReaderKeyHandler);
      activeReaderKeyHandler = null;
    }
  }

  // ---------- shared helpers ----------

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Parses a raw OBS story markdown file into a slide deck: one title, N
  // frames (each exactly one image + its paragraph — verified against real
  // story files, e.g. unfoldingWord/en_obs content/01.md: "# 1. The
  // Creation", then 16 repeating image/paragraph pairs, then a trailing
  // italic reference line), and that trailing reference.
  function parseObsFrames(md) {
    const withoutFrontmatter = md.replace(/^---\n[\s\S]*?\n---\n/, "");
    const blocks = withoutFrontmatter
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter(Boolean);

    let title = "";
    let reference = "";
    const rawFrames = [];
    let cursor = 0;

    if (blocks.length > 0) {
      const headingMatch = blocks[0].match(/^(#{1,6})\s*(.*)$/);
      if (headingMatch) {
        title = headingMatch[2];
        cursor = 1;
      }
    }

    for (let i = cursor; i < blocks.length; i++) {
      const block = blocks[i];

      // A whole block wrapped in one pair of underscores or asterisks is the
      // trailing Bible-reference line (e.g. "_A Bible story from: Genesis
      // 1-2_") — verified always the final block in real content, so this
      // only fires there rather than risking a false match mid-story.
      const refMatch = i === blocks.length - 1 && block.match(/^[_*](.+)[_*]$/);
      if (refMatch) {
        reference = refMatch[1];
        continue;
      }

      const img = block.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (img) {
        rawFrames.push({ alt: img[1], image: img[2], textParts: [] });
        continue;
      }

      // Any other block belongs to whichever frame's image came right
      // before it — normally exactly one paragraph per image in real OBS
      // content; concatenating handles the rare case of more than one.
      const target = rawFrames[rawFrames.length - 1];
      if (!target) continue; // text before any image isn't expected in real content

      const lines = block
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const isList =
        lines.length > 0 && lines.every((l) => /^[*-]\s+/.test(l));
      if (isList) {
        const items = lines
          .map(
            (l) =>
              `<li style="margin-bottom:4px;">${escapeHtml(
                l.replace(/^[*-]\s+/, "")
              )}</li>`
          )
          .join("");
        target.textParts.push(
          `<ul style="margin:0 0 10px 0; padding:0 0 0 22px; text-align:left;">${items}</ul>`
        );
      } else {
        target.textParts.push(`<p style="margin:0;">${escapeHtml(block)}</p>`);
      }
    }

    return {
      title,
      reference,
      frames: rawFrames.map((f) => ({
        image: f.image,
        alt: f.alt,
        text: f.textParts.join(""),
      })),
    };
  }

  function isStubContent(md) {
    if (!md) return false;
    return /video[\s-]*only/i.test(md.slice(0, 300));
  }

  function extAssets(entry, ext) {
    const assets = (entry.release && entry.release.assets) || [];
    return assets.filter((a) => a.name.toLowerCase().endsWith(ext));
  }

  // Best-effort: pull a story number out of an asset filename like
  // "fr_obs_v4.3_07_128kbps.mp3" or "sw_obs_07.mp3".
  function storyNumberFromFilename(name) {
    const matches = name.match(/_(\d{1,2})(?=[_.])/g);
    if (!matches || matches.length === 0) return null;
    const last = matches[matches.length - 1].replace(/_/g, "");
    const n = parseInt(last, 10);
    return Number.isFinite(n) ? n : null;
  }

  function contentPathFor(entry) {
    const ing = entry.ingredients && entry.ingredients[0];
    if (!ing || !ing.path) return "content";
    return ing.path.replace(/^\.\/?/, "").replace(/\/$/, "");
  }

  // ---------- legacy "ts" (translationStudio) format support ----------
  //
  // Verified real layout (fa_gl/azb_obs and 15 sibling repos, all metadata_type
  // "ts"): instead of one "content/NN.md" file per story, each story is a
  // zero-padded numbered directory ("01".."50") at the repo root containing
  // one ".txt" file per frame, plus "title.txt" and "reference.txt". OBS
  // illustrations are shared across every translation and resolve from a
  // fixed CDN path keyed only by story+frame number (verified against
  // unfoldingWord/en_obs's own current RC-format story markdown, which
  // embeds these exact URLs).

  function isTsFormat(entry) {
    return entry.metadata_type === "ts";
  }

  function tsStoryImageUrl(storyNum, frameNum) {
    const pad = (n) => String(n).padStart(2, "0");
    return `https://cdn.door43.org/obs/jpg/360px/obs-en-${pad(storyNum)}-${pad(
      frameNum
    )}.jpg`;
  }

  function fetchTsStoryDirs(entry) {
    const url = `https://git.door43.org/api/v1/repos/${entry.owner}/${entry.name}/contents/?ref=${entry.branch_or_tag_name}`;
    return fetch(url)
      .then((res) => res.json())
      .then((files) =>
        (files || [])
          .filter((f) => f.type === "dir" && /^\d+$/.test(f.name))
          .map((f) => ({ file: { name: f.name }, num: parseInt(f.name, 10) }))
          .sort((a, b) => a.num - b.num)
      );
  }

  function fetchTsStoryContent(entry, dirName) {
    const listUrl = `https://git.door43.org/api/v1/repos/${entry.owner}/${entry.name}/contents/${dirName}?ref=${entry.branch_or_tag_name}`;
    return fetch(listUrl)
      .then((res) => res.json())
      .then((files) => {
        const frameFiles = (files || [])
          .filter((f) => /^\d+\.txt$/i.test(f.name))
          .map((f) => ({ file: f, num: parseInt(f.name, 10) }))
          .sort((a, b) => a.num - b.num);
        const titleFile = (files || []).find((f) => f.name === "title.txt");
        const referenceFile = (files || []).find(
          (f) => f.name === "reference.txt"
        );

        const fetchText = (f) =>
          f && f.download_url
            ? fetch(f.download_url).then((r) => (r.ok ? r.text() : ""))
            : Promise.resolve("");

        return Promise.all([
          fetchText(titleFile),
          Promise.all(
            frameFiles.map((f) =>
              fetchText(f.file).then((text) => ({ num: f.num, text: text.trim() }))
            )
          ),
          fetchText(referenceFile),
        ]).then(([title, frames, reference]) => ({
          title: title.trim(),
          frames,
          reference: reference.trim(),
        }));
      });
  }

  // Same {title, frames, reference} shape as parseObsFrames, built directly
  // from the already-structured ts-format data (no markdown to parse here —
  // each frame's text file IS the frame).
  function tsStoryToFrames(storyNum, storyData) {
    return {
      title: storyData.title,
      reference: storyData.reference,
      frames: storyData.frames.map((f) => ({
        image: tsStoryImageUrl(storyNum, f.num),
        alt: "",
        text: f.text ? `<p style="margin:0;">${escapeHtml(f.text)}</p>` : "",
      })),
    };
  }

  // Fetches and parses one story into a slide deck for a given entry,
  // regardless of format.
  function loadStoryFrames(entry, storyFileEntry) {
    if (isTsFormat(entry)) {
      return fetchTsStoryContent(entry, storyFileEntry.file.name).then((data) =>
        tsStoryToFrames(storyFileEntry.num, data)
      );
    }
    const contentPath = contentPathFor(entry);
    const path = [contentPath, storyFileEntry.file.name].filter(Boolean).join("/");
    const url = `https://git.door43.org/${entry.owner}/${entry.name}/raw/${entry.branch_or_tag_name}/${path}`;
    return fetch(url)
      .then((res) => (res.ok ? res.text() : Promise.reject()))
      .then((md) => parseObsFrames(md));
  }

  // Cheap title-only fetch for populating the story picker's labels.
  function fetchStoryTitle(entry, storyFileEntry) {
    if (isTsFormat(entry)) {
      const titleUrl = `https://git.door43.org/${entry.owner}/${entry.name}/raw/${entry.branch_or_tag_name}/${storyFileEntry.file.name}/title.txt`;
      return fetch(titleUrl).then((res) => (res.ok ? res.text() : ""));
    }
    const contentPath = contentPathFor(entry);
    const path = [contentPath, storyFileEntry.file.name].filter(Boolean).join("/");
    const url = `https://git.door43.org/${entry.owner}/${entry.name}/raw/${entry.branch_or_tag_name}/${path}`;
    return fetch(url)
      .then((res) => (res.ok ? res.text() : ""))
      .then((md) => {
        const titleMatch = md
          .replace(/^---\n[\s\S]*?\n---\n/, "")
          .match(/^#+\s*(.*)$/m);
        return titleMatch ? titleMatch[1] : "";
      });
  }

  function matchesSearch(langRow, query) {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      langRow.title.toLowerCase().includes(q) ||
      langRow.code.toLowerCase().includes(q)
    );
  }

  function matchesFormat(langRow, format) {
    if (format === "all") return true;
    return !!(langRow.formats && langRow.formats[format]);
  }

  // ---------- browse list (one row per language) ----------

  // Reads the prerendered rows once; filtering then just hides/shows them.
  function readPrerenderedList() {
    uniqueLanguages = Array.from(listEl.querySelectorAll(".lang-row")).map((row) => ({
      code: row.dataset.lang,
      title: row.dataset.title || row.dataset.lang,
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

  // ---------- detail / reader ----------

  function showDetail(code) {
    const group = languageGroups.get(code) || [];
    if (group.length === 0) return;

    if (location.hash.replace("#", "") !== code) location.hash = code;
    browseEl.hidden = true;
    detailEl.hidden = false;

    const displayEntry = group[0];
    detailEl.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; margin-bottom:20px;">
        <button id="back-to-browse" class="btn btn-outline">&larr; ${escapeHtml(
          str("back", "Back to Discover")
        )}</button>
        <a href="/discover/read/?lang=${encodeURIComponent(
          code
        )}" target="_blank" rel="noopener" class="btn btn-outline">${escapeHtml(
          str("openFull", "Open full page")
        )} &#8599;</a>
      </div>
      <h2 style="color:var(--ocean); margin-bottom:4px;">${displayEntry.language_title}</h2>
      <p style="color:#4a5960; margin-bottom:20px;">${displayEntry.language} &middot; unfoldingWord&reg; Open Bible Stories</p>
      <div id="detail-body"><p style="color:#4a5960;">Loading...</p></div>
    `;

    document
      .getElementById("back-to-browse")
      .addEventListener("click", () => {
        // Clearing the hash triggers syncFromHash(), which shows the list.
        if (location.hash) location.hash = "";
        else showBrowse();
      });

    renderLanguageBody(group, document.getElementById("detail-body"));
  }

  // Extracted so the standalone full-page reader (/discover/read/) can
  // reuse the same duplicate-handling logic without duplicating it.
  function renderLanguageBody(group, bodyEl) {
    if (group.length === 1) {
      renderReaderFor(group[0], bodyEl, null);
      return;
    }

    // More than one catalog entry — always let the user see and choose
    // between every publisher, rather than silently hiding one (verified
    // real gap: a "video-only" stub entry was being merged away entirely,
    // even though it might carry a real YouTube link worth surfacing).
    bodyEl.innerHTML = `
      <div style="margin-bottom:22px;">
        <label for="publisher-select" style="display:block; font-size:0.85rem; font-weight:700; color:var(--ocean); margin-bottom:8px;">
          ${group.length} teams have published this language &mdash; choose which one to view:
        </label>
        <select id="publisher-select" style="font-size:1rem; padding:10px 18px; border-radius:999px; border:1px solid rgba(1,66,99,0.25); background:var(--white); color:var(--ocean); font-weight:700; max-width:100%;">
          ${group
            .map((e, i) => {
              let label = e.title || e.owner;
              const sameTitleCount = group.filter(
                (o) => (o.title || o.owner) === label
              ).length;
              if (sameTitleCount > 1) label = `${label} (${e.name})`;
              return `<option value="${i}">${escapeHtml(
                label
              )} &mdash; ${escapeHtml(e.owner)}</option>`;
            })
            .join("")}
        </select>
      </div>
      <div id="publisher-body"></div>
    `;

    const selectEl = document.getElementById("publisher-select");
    const publisherBodyEl = document.getElementById("publisher-body");

    function renderIdx(i) {
      publisherBodyEl.innerHTML = "";
      const e = group[i];
      renderReaderFor(e, publisherBodyEl, `${e.title || e.owner} (${e.owner})`);
    }

    selectEl.addEventListener("change", () => {
      renderIdx(parseInt(selectEl.value, 10));
    });

    // Classification only picks a sensible default (prefer real content
    // over a stub) — it never removes an option from the dropdown.
    classifyGroup(group)
      .then(({ real }) => {
        if (real.length > 0) {
          const defaultIdx = group.indexOf(real[0]);
          if (defaultIdx >= 0) selectEl.value = defaultIdx;
        }
        renderIdx(parseInt(selectEl.value, 10));
      })
      .catch(() => renderIdx(0));
  }

  function classifyGroup(entries) {
    return Promise.all(
      entries.map((e) => {
        const url = `https://git.door43.org/${e.owner}/${e.name}/raw/${e.branch_or_tag_name}/content/01.md`;
        return fetch(url)
          .then((res) => (res.ok ? res.text() : ""))
          .then((md) => ({ entry: e, isStub: isStubContent(md) }))
          .catch(() => ({ entry: e, isStub: false }));
      })
    ).then((results) => ({
      real: results.filter((r) => !r.isStub).map((r) => r.entry),
    }));
  }

  // Fetches the list of real story files for an entry, handling whichever
  // naming scheme it actually uses (verified real cases: "01.md" vs
  // "obs_story_1.md", plus the ts-format's numbered directories).
  function fetchStoryFiles(entry) {
    if (isTsFormat(entry)) {
      return fetchTsStoryDirs(entry);
    }
    const contentPath = contentPathFor(entry);
    const contentsUrl = `https://git.door43.org/api/v1/repos/${entry.owner}/${entry.name}/contents/${contentPath}?ref=${entry.branch_or_tag_name}`;
    return fetch(contentsUrl)
      .then((res) => res.json())
      .then((files) =>
        (files || [])
          .filter((f) => /\.md$/i.test(f.name) && /\d+/.test(f.name))
          .map((f) => ({
            file: f,
            num: parseInt(f.name.match(/(\d+)/)[0], 10),
          }))
          .sort((a, b) => a.num - b.num)
      );
  }

  // Renders just the reader itself: story text, prev/next, and a
  // title-populated story picker. No side panel, no format badges, no
  // download buttons — that's all on the full Library page instead.
  // A text release and an audio/video release can genuinely be different
  // versions of the same repo — verified real case: unfoldingWord/en_obs's
  // current text release (v9, 2023) shipped only a PDF, while the audio and
  // video full 50-story sets only exist on the older v8 (2020) release.
  // Rather than assume "latest release" means "latest of everything", this
  // walks the repo's full release history and resolves each format
  // independently to whichever release actually has it.
  function fetchAllReleases(entry) {
    const url = `https://git.door43.org/api/v1/repos/${entry.owner}/${entry.name}/releases`;
    return fetch(url)
      .then((res) => (res.ok ? res.json() : []))
      .then((releases) =>
        (releases || [])
          .filter((r) => !r.draft)
          .sort(
            (a, b) => new Date(b.published_at) - new Date(a.published_at)
          )
      )
      .catch(() => []);
  }

  function latestReleaseWithExt(releases, ext) {
    for (const r of releases) {
      const match = (r.assets || []).find((a) =>
        a.name.toLowerCase().endsWith(ext)
      );
      if (match) return { release: r, asset: match };
    }
    return null;
  }

  function latestReleaseWithAllExt(releases, ext) {
    for (const r of releases) {
      const matches = (r.assets || []).filter((a) =>
        a.name.toLowerCase().endsWith(ext)
      );
      if (matches.length > 0) return { release: r, assets: matches };
    }
    return null;
  }

  // Verified real format: a single "YouTube" named asset per release,
  // pointing at a playlist URL (e.g. "youtube.com/playlist?list=...").
  // Direct .mp4 file links (filedn.com) turned out unreliable to embed
  // inline (see below) — YouTube is the one video source safe to embed.
  function youtubeEmbedUrl(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (e) {
      return null;
    }
    const host = parsed.hostname.replace(/^www\./, "");
    if (host !== "youtube.com" && host !== "youtu.be") return null;

    const listId = parsed.searchParams.get("list");
    if (listId) return `https://www.youtube.com/embed/videoseries?list=${listId}`;

    if (host === "youtu.be") {
      const videoId = parsed.pathname.replace(/^\//, "");
      if (videoId) return `https://www.youtube.com/embed/${videoId}`;
    }
    const videoId = parsed.searchParams.get("v");
    if (videoId) return `https://www.youtube.com/embed/${videoId}`;

    return null;
  }

  function latestReleaseWithYouTube(releases) {
    for (const r of releases) {
      const match = (r.assets || []).find((a) =>
        youtubeEmbedUrl(a.browser_download_url)
      );
      if (match) return { release: r, asset: match };
    }
    return null;
  }


  function renderReaderFor(entry, container, tag) {
    container.innerHTML = `
      ${
        tag
          ? `<div style="display:inline-block; background:var(--panel); color:var(--ocean); font-weight:700; font-size:0.78rem; padding:4px 12px; border-radius:999px; margin-bottom:16px;">Translation by ${escapeHtml(
              tag
            )}</div>`
          : ""
      }
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:14px; flex-wrap:wrap;">
        <select class="study-story-select" aria-label="Jump to a story" style="font-size:0.9rem; color:var(--ocean); font-weight:700; border:1px solid rgba(1,66,99,0.25); border-radius:999px; padding:6px 14px; background:var(--white); max-width:320px;">
          <option>Loading stories...</option>
        </select>
        <div class="story-links" style="display:flex; gap:14px; margin-left:auto; font-size:0.82rem;"></div>
      </div>
      <div class="youtube-embed" style="margin-bottom:14px;"></div>
      <div class="story-media" style="display:flex; flex-direction:column; gap:4px; margin-bottom:14px;"></div>
      <div class="study-main" style="border:1px solid rgba(1,66,99,0.12); border-radius:12px; padding:24px 24px 0; height:clamp(440px, 64vh, 620px); display:flex; flex-direction:column; background:var(--white); text-align:center;">
        <p style="color:#4a5960; font-size:0.9rem;">Loading story...</p>
      </div>
    `;

    setupReader(entry, container);
  }

  function setupReader(entry, container) {
    let current = 1;
    let maxStory = 1;
    let storyFiles = [];
    let audioByStory = {};
    let audioTag = null;

    // ---- slide-deck state for the currently loaded story ----
    let currentStoryData = null; // {title, reference, frames}
    let slideIndex = 0;
    let restoreFocus = null; // "prev" | "next" — which control to re-focus after a re-render

    const mainEl = container.querySelector(".study-main");
    const mediaEl = container.querySelector(".story-media");
    const youtubeEl = container.querySelector(".youtube-embed");
    const linksEl = container.querySelector(".story-links");
    const selectEl = container.querySelector(".study-story-select");

    // One image + its paragraph per slide, with Prev/Next that keep
    // flipping right across a story boundary into the next/previous story
    // (rather than stopping and forcing a trip back to the dropdown) — the
    // "read straight through the whole book" experience a slide deck implies.
    // The Prev/Next controls live in a fixed-position footer, separate from
    // the image+text pane above them. Previously the whole slide (image,
    // title, text) and the controls were rendered as one block inside a
    // box that grew and shrank with content height — since image aspect
    // ratio and paragraph length both vary slide to slide, the Next button
    // ended up at a different vertical position after almost every click,
    // forcing a mouse/trackpad reposition each time. Now `.study-main` has
    // a fixed height (see renderReaderFor) and only the `.slide-content`
    // pane scrolls internally when a frame's image+text don't fit — the
    // `.slide-controls` footer below it never moves.
    function renderSlideDeck() {
      const frames = (currentStoryData && currentStoryData.frames) || [];

      if (frames.length === 0) {
        mainEl.innerHTML = `
          <div class="slide-content" style="flex:1 1 auto; min-height:0; overflow-y:auto;">
            ${
              currentStoryData && currentStoryData.title
                ? `<h3 style="color:var(--ocean); margin:0 0 16px;">${escapeHtml(
                    currentStoryData.title
                  )}</h3>`
                : ""
            }
            <p style="color:#4a5960; font-size:0.9rem;">This story couldn't be broken into slides automatically. <a href="https://git.door43.org/${entry.owner}/${entry.name}" style="color:var(--inspire-text);">View the raw file on Door43</a>.</p>
          </div>
        `;
        return;
      }

      const frame = frames[slideIndex];
      mainEl.innerHTML = `
        <div class="slide-content" style="flex:1 1 auto; min-height:0; overflow-y:auto; padding-bottom:8px;">
          ${
            currentStoryData.title
              ? `<h3 style="color:var(--ocean); margin:0 0 18px;">${escapeHtml(
                  currentStoryData.title
                )}</h3>`
              : ""
          }
          ${
            frame.image
              ? `<img src="${frame.image}" alt="${escapeHtml(
                  frame.alt || ""
                )}" loading="lazy" style="width:100%; max-width:460px; border-radius:10px; margin:0 auto 18px; display:block;">`
              : ""
          }
          <div style="max-width:460px; margin:0 auto; font-size:1.02rem; line-height:1.6; color:var(--tech);">${
            frame.text
          }</div>
          ${
            currentStoryData.reference
              ? `<p style="color:#64747d; font-size:0.82rem; font-style:italic; margin-top:20px;">${escapeHtml(
                  currentStoryData.reference
                )}</p>`
              : ""
          }
        </div>
        <div class="slide-controls" style="flex:0 0 auto; display:flex; align-items:center; justify-content:center; gap:18px; padding:16px 0; margin-top:auto; border-top:1px solid rgba(1,66,99,0.08);">
          <button class="slide-prev btn btn-outline" style="padding:8px 18px; font-size:0.85rem;">&larr; Back</button>
          <span style="color:#4a5960; font-size:0.85rem; font-weight:700; min-width:70px;">${
            slideIndex + 1
          } / ${frames.length}</span>
          <button class="slide-next btn btn-outline" style="padding:8px 18px; font-size:0.85rem;">Next &rarr;</button>
        </div>
      `;

      const slidePrevBtn = mainEl.querySelector(".slide-prev");
      const slideNextBtn = mainEl.querySelector(".slide-next");
      slidePrevBtn.disabled = slideIndex <= 0 && current <= 1;
      slideNextBtn.disabled = slideIndex >= frames.length - 1 && current >= maxStory;
      slidePrevBtn.addEventListener("click", () => goToSlide(slideIndex - 1, "prev"));
      slideNextBtn.addEventListener("click", () => goToSlide(slideIndex + 1, "next"));

      // Re-rendering replaced the button the keyboard user had focused —
      // without this, focus falls back to <body> on every slide advance and
      // they'd have to tab down from the top of the page for each frame.
      if (restoreFocus === "prev" || restoreFocus === "next") {
        const btn = restoreFocus === "prev" ? slidePrevBtn : slideNextBtn;
        (btn.disabled ? (restoreFocus === "prev" ? slideNextBtn : slidePrevBtn) : btn).focus();
      }
      restoreFocus = null;
    }

    // newIndex outside the current story's frame range crosses into the
    // next/previous story (landing on its first or last slide, whichever
    // makes the flip feel continuous) rather than just disabling the button.
    function goToSlide(newIndex, focusTarget) {
      if (focusTarget) restoreFocus = focusTarget;
      const frames = (currentStoryData && currentStoryData.frames) || [];

      if (newIndex < 0) {
        if (current > 1) {
          current -= 1;
          update("last");
        }
        return;
      }
      if (newIndex >= frames.length) {
        if (current < maxStory) {
          current += 1;
          update(0);
        }
        return;
      }
      slideIndex = newIndex;
      renderSlideDeck();
    }

    // startAt: 0 (default, first slide) or "last" (landing on a story from
    // its end, when flipping backward across a story boundary).
    function loadStoryText(num, startAt) {
      mainEl.innerHTML =
        '<p style="color:#4a5960; font-size:0.9rem;">Loading story...</p>';
      const match = storyFiles.find((s) => s.num === num);
      if (!match) {
        mainEl.innerHTML =
          '<p style="color:#4a5960; font-size:0.9rem;">Couldn\'t find this story.</p>';
        return;
      }
      loadStoryFrames(entry, match)
        .then((storyData) => {
          currentStoryData = storyData;
          const frameCount = (storyData.frames || []).length;
          slideIndex = startAt === "last" ? Math.max(frameCount - 1, 0) : 0;
          renderSlideDeck();
        })
        .catch(() => {
          mainEl.innerHTML =
            '<p style="color:#b23; font-size:0.9rem;">Couldn\'t load this story right now.</p>';
        });
    }

    function buildStorySelect() {
      selectEl.innerHTML = storyFiles
        .map(
          ({ num }) =>
            `<option value="${num}"${
              num === current ? " selected" : ""
            }>Story ${num}</option>`
        )
        .join("");

      storyFiles.forEach((storyFileEntry) => {
        fetchStoryTitle(entry, storyFileEntry)
          .then((title) => {
            if (!title) return;
            const opt = selectEl.querySelector(
              `option[value="${storyFileEntry.num}"]`
            );
            if (opt) opt.textContent = title.trim();
          })
          .catch(() => {});
      });
    }

    function updateMedia(num) {
      const parts = [];
      if (audioByStory[num]) {
        parts.push(
          `<div><audio controls preload="none" style="height:36px; max-width:260px;" src="${
            audioByStory[num].browser_download_url
          }"></audio>${
            audioTag && audioTag !== entry.branch_or_tag_name
              ? ` <span style="font-size:0.75rem; color:#64747d;">audio from ${escapeHtml(
                  audioTag
                )}</span>`
              : ""
          }</div>`
        );
      }
      mediaEl.innerHTML = parts.join("");
    }

    // startAt forwards through to loadStoryText — see its comment above.
    function update(startAt) {
      selectEl.value = current;
      loadStoryText(current, startAt);
      updateMedia(current);
    }

    selectEl.addEventListener("change", () => {
      current = parseInt(selectEl.value, 10);
      update(0);
    });
    // Arrow-key flipping. Only one reader is ever active at a time on this
    // page (the browse list and its search box are hidden while a reader is
    // shown), but a fresh setupReader() call — e.g. switching teams in the
    // publisher dropdown — needs to replace the previous handler rather than
    // stack a second one controlling a now-detached container.
    clearReaderKeyHandler();
    activeReaderKeyHandler = function (ev) {
      if (ev.target && /^(input|textarea|select)$/i.test(ev.target.tagName)) return;
      if (ev.key === "ArrowRight") goToSlide(slideIndex + 1);
      else if (ev.key === "ArrowLeft") goToSlide(slideIndex - 1);
    };
    document.addEventListener("keydown", activeReaderKeyHandler);

    // Always available regardless of asset content.
    linksEl.innerHTML = `<a href="https://git.door43.org/${entry.owner}/${entry.name}" target="_blank" rel="noopener" style="color:var(--inspire-text);">View source on Door43</a>`;

    fetchStoryFiles(entry).then((files) => {
      storyFiles = files;
      maxStory = storyFiles.length || 1;
      buildStorySelect();
      update();
    });

    // Independently resolve the latest release that actually has audio,
    // video, or a PDF — may well differ from the text's own release.
    fetchAllReleases(entry).then((releases) => {
      if (releases.length === 0) return;

      const audioFound = latestReleaseWithAllExt(releases, ".mp3");
      if (audioFound) {
        audioTag = audioFound.release.tag_name;
        audioFound.assets.forEach((f) => {
          const n = storyNumberFromFilename(f.name);
          if (!n) return;
          const bitrateMatch = f.name.match(/(\d+)kbps/i);
          const bitrate = bitrateMatch ? parseInt(bitrateMatch[1], 10) : 0;
          const existing = audioByStory[n];
          const existingBitrate = existing
            ? parseInt((existing.name.match(/(\d+)kbps/i) || [0, 0])[1], 10)
            : -1;
          if (!existing || bitrate > existingBitrate) {
            audioByStory[n] = f;
          }
        });
      }

      const youtubeFound = latestReleaseWithYouTube(releases);
      if (youtubeFound) {
        const embedUrl = youtubeEmbedUrl(youtubeFound.asset.browser_download_url);
        const tagNote =
          youtubeFound.release.tag_name !== entry.branch_or_tag_name
            ? `<span style="font-size:0.75rem; color:#64747d; display:block; margin-top:4px;">from ${escapeHtml(
                youtubeFound.release.tag_name
              )}</span>`
            : "";
        youtubeEl.innerHTML = `
          <div style="position:relative; padding-top:56.25%; border-radius:12px; overflow:hidden; background:#000;">
            <iframe src="${embedUrl}" loading="lazy" allowfullscreen
              style="position:absolute; inset:0; width:100%; height:100%; border:none;"></iframe>
          </div>
          ${tagNote}
        `;
      }
      // Note: direct .mp4 file links (filedn.com) exist for some
      // languages too, but rendering them inline turned out unreliable —
      // YouTube is the only video source embedded here on purpose.

      const pdfFound = latestReleaseWithExt(releases, ".pdf");
      if (pdfFound) {
        const pdfTagNote =
          pdfFound.release.tag_name !== entry.branch_or_tag_name
            ? ` <span style="color:#64747d;">(${escapeHtml(
                pdfFound.release.tag_name
              )})</span>`
            : "";
        linksEl.innerHTML =
          `<a href="${pdfFound.asset.browser_download_url}" target="_blank" rel="noopener" style="color:var(--inspire-text);">Print (PDF)</a>${pdfTagNote}` +
          ` &middot; ` +
          linksEl.innerHTML;
      }

      updateMedia(current);
    });
  }

  // ---------- wiring ----------

  const fullReaderEl = document.getElementById("full-reader");

  if (fullReaderEl) {
    // Standalone full-page reader (/discover/read/?lang=CODE) — fetches
    // just that one language rather than the full catalog, and renders
    // straight into the page with no browse list around it.
    const params = new URLSearchParams(window.location.search);
    const code = params.get("lang");

    if (!code) {
      fullReaderEl.innerHTML =
        '<p style="color:#4a5960;">No language specified. Go back to Discover and pick one.</p>';
    } else {
      fullReaderEl.innerHTML =
        '<p style="color:#4a5960;">Loading...</p>';

      fetch(
        `https://git.door43.org/api/v1/catalog/search?subject=Open%20Bible%20Stories&stage=prod&lang=${encodeURIComponent(
          code
        )}`
      )
        .then((res) => res.json())
        .then((data) => {
          const group = (data.data || []).filter(
            (e) => !/theological formation/i.test(e.title || "")
          );
          if (group.length === 0) {
            fullReaderEl.innerHTML =
              '<p style="color:#4a5960;">Couldn\'t find this language.</p>';
            return;
          }
          fullReaderEl.innerHTML = "";
          renderLanguageBody(group, fullReaderEl);
        })
        .catch(() => {
          fullReaderEl.innerHTML =
            '<p style="color:#4a5960;">Couldn\'t load this right now.</p>';
        });
    }
  } else if (browseEl) {
    readPrerenderedList();

    // WebSite SearchAction (JSON-LD in Base.astro) lands here with ?q=.
    const initialQuery = new URLSearchParams(window.location.search).get("q");
    if (initialQuery && !searchEl.value) searchEl.value = initialQuery;
    renderList();

    searchEl.addEventListener("input", renderList);

    function showBrowse() {
      detailEl.hidden = true;
      browseEl.hidden = false;
      clearReaderKeyHandler();
    }

    // Language code from the URL fragment. Legacy /library deep links used
    // codes like "kmz--fa_gl--kmz_obs_text_obs" (language code + team/resource
    // id); keep only the language code.
    function codeFromHash() {
      let hashCode = decodeURIComponent(location.hash.replace("#", ""));
      const legacySep = hashCode.indexOf("--");
      if (legacySep !== -1) hashCode = hashCode.slice(0, legacySep);
      return hashCode;
    }

    // The URL fragment is the single source of truth for "which language is
    // open": rows are plain links to #code, the Back button clears it, and the
    // browser's own back/forward buttons work. Until the catalog has loaded
    // there is nothing to render for a code, so this is re-run after hydrate.
    function syncFromHash() {
      const code = codeFromHash();
      if (code && languageGroups.has(code)) {
        showDetail(code);
      } else if (!code) {
        showBrowse();
      }
    }
    window.addEventListener("hashchange", syncFromHash);

    // Row clicks navigate to #code, which syncFromHash picks up. When the
    // clicked code isn't in the loaded catalog (or the catalog is still
    // loading), the default link behaviour keeps the hash so the language
    // opens as soon as the data arrives.
    listEl.addEventListener("click", (ev) => {
      const row = ev.target.closest(".lang-row");
      if (!row || !languageGroups.has(row.dataset.lang)) return;
      ev.preventDefault();
      if (location.hash.replace("#", "") === row.dataset.lang) showDetail(row.dataset.lang);
      else location.hash = row.dataset.lang;
    });

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

    // Shared by both the cache-hit and live-fetch paths so there's exactly
    // one place that builds languageGroups from a list of (already-trimmed)
    // catalog entries. The visible list itself is prerendered (see
    // readPrerenderedList); the catalog is what the reader needs.
    function hydrateFromEntries(languages) {
      languageGroups = new Map();
      languages.forEach((e) => {
        const arr = languageGroups.get(e.language) || [];
        arr.push(e);
        languageGroups.set(e.language, arr);
      });

      // The build-time list and the live catalog normally agree; if a
      // language was published since the last deploy it has no prerendered
      // row, so append one (formats from attachment_types, as at build time)
      // rather than silently hiding a real translation until the next build.
      const known = new Set(uniqueLanguages.map((l) => l.code));
      let appended = false;
      languageGroups.forEach((entries, code) => {
        if (known.has(code)) return;
        const li = document.createElement("li");
        const has = (k) => entries.some((e) => e.attachment_types && e.attachment_types[k]);
        const formats = { pdf: has("pdf"), audio: has("audio"), video: has("video") || has("stream") };
        const title = entries[0].language_title || code;
        li.innerHTML =
          `<a class="lang-row" href="#${encodeURIComponent(code)}" data-lang="${escapeHtml(code)}" data-title="${escapeHtml(title)}"` +
          (formats.pdf ? ' data-pdf="1"' : "") +
          (formats.audio ? ' data-audio="1"' : "") +
          (formats.video ? ' data-video="1"' : "") +
          `><div><div class="name">${escapeHtml(title)}</div><div class="code"><code>${escapeHtml(code)}</code></div></div>` +
          `<div class="badges">` +
          (formats.pdf ? '<span class="badge">Print</span>' : "") +
          (formats.audio ? '<span class="badge audio">Audio</span>' : "") +
          (formats.video ? '<span class="badge video">Video</span>' : "") +
          `</div></a>`;
        listEl.appendChild(li);
        appended = true;
      });
      if (appended) {
        readPrerenderedList();
        renderList();
      }

      syncFromHash();
    }

    function renderLoadError() {
      // A dead-end "try refreshing" line helps nobody — especially behind
      // the restrictive networks common in the regions this project serves.
      // Offer an in-place retry plus the two working alternate routes.
      statusEl.innerHTML =
        'The stories couldn\'t be loaded — the Door43 catalog may be ' +
        'unreachable from your network. ' +
        '<button type="button" id="lib-retry" class="btn btn-outline" style="padding:8px 18px; font-size:0.85rem; margin:10px 6px 0;">Try again</button>' +
        '<span style="display:block; margin-top:10px;">You can also browse on ' +
        '<a href="https://door43.org" target="_blank" rel="noopener" style="color:var(--inspire-text); text-decoration:underline;">Door43</a> ' +
        'or use the <a href="https://play.google.com/store/apps/details?id=com.unfoldingword.obsapp" target="_blank" rel="noopener" style="color:var(--inspire-text); text-decoration:underline;">OBS mobile app</a>.</span>';
      const retryBtn = document.getElementById("lib-retry");
      if (retryBtn) retryBtn.addEventListener("click", loadCatalog);
    }

    function loadCatalog() {
      // The prerendered list is already visible; only the reader is pending.
      if (uniqueLanguages.length === 0) statusEl.textContent = str("loading", "Loading languages...");

      fetch(CATALOG_URL)
        .then((res) => {
          // See the same check in library.js: catches a future silent
          // truncation of the language list rather than staying quiet about it.
          const totalHeader = res.headers.get("X-Total-Count");
          return res.json().then((data) => ({ data, totalHeader }));
        })
        .then(({ data, totalHeader }) => {
          const entries = data.data || [];
          const expectedTotal = totalHeader ? parseInt(totalHeader, 10) : null;
          if (expectedTotal && expectedTotal > entries.length) {
            console.warn(
              `OBS catalog fetch returned ${entries.length} entries but X-Total-Count reports ${expectedTotal} — the language list may be incomplete. This endpoint needs pagination (page= param) now.`
            );
          }

          const languages = entries
            .filter((e) => !/theological formation/i.test(e.title || ""))
            .map(trimCatalogEntry);

          writeCatalogCache(languages);
          hydrateFromEntries(languages);
        })
        .catch(renderLoadError);
    }

    const cachedEntries = readCatalogCache();

    if (cachedEntries) {
      // Instant render, no network round-trip — see the caching comment
      // near CATALOG_CACHE_KEY above for why this exists and what it saves.
      hydrateFromEntries(cachedEntries);
    } else {
      loadCatalog();
    }
  }
})();
