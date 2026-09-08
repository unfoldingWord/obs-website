(function () {
  "use strict";
  // The Open Bible Stories reader, mounted on a language hub (/l/{code}/).
  //
  // Lifted verbatim out of discover.js, where it used to serve both the
  // inline Discover detail view and the standalone /discover/read/ page.
  // Both of those are gone: Discover only discovers, and each story also has
  // its own static page (/l/{code}/story-{n}/) for crawlers and for
  // reading without JavaScript. This is the in-place reading experience —
  // slide-flip navigation, a story picker, per-story audio, YouTube where it
  // exists, and the publisher chooser when several teams have published the
  // same language.
  //
  // It still reads the live DCS catalog for one language, exactly as before,
  // so a newly published release shows up here without a rebuild. (The build
  // now also has the full story text in src/data/stories/{code}.json, so
  // feeding this from the page instead of the network is an easy follow-up —
  // it would make the reader work when Door43 is unreachable.)
  //
  // Exposes: window.OBSReader.mount(el, code, { initialStory, strings }).

  const LANG_CATALOG_URL =
    "https://git.door43.org/api/v1/catalog/search?subject=Open%20Bible%20Stories&stage=prod&lang=";

  // Story to open first, from a ?story= / #story-N deep link.
  let initialStory = null;

  // Story text for this language, served by /l/{code}/stories.json (the same
  // text the story pages are built from). When it is present the reader needs
  // no Door43 request to read: no repo listing, no 50 title fetches, no fetch
  // per story. Null when the endpoint is missing (a build with no story text),
  // in which case every seam below falls back to the original live fetch.
  let local = null;

  /** Local stories apply only to the entry they were read from — switching
   *  publishers has to go back to Door43 for that team's text. */
  function localFor(entry) {
    if (!local || !local.primary || !entry) return null;
    return local.primary.owner === entry.owner && local.primary.name === entry.name
      ? local
      : null;
  }

  function localStory(entry, num) {
    const bundle = localFor(entry);
    if (!bundle) return null;
    return bundle.stories.find((s) => s.num === num) || null;
  }
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
    // Entries from /l/{code}/stories.json carry the path already resolved;
    // ones from the live catalog carry the raw ingredients list.
    if (entry.contentPath) return entry.contentPath;
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
    const story = storyFileEntry && storyFileEntry.local;
    if (story) {
      return Promise.resolve({
        title: story.title || "",
        reference: story.reference || "",
        // parseObsFrames yields {alt, image, text}; the build stores no alt
        // text (the illustrations are decorative beside the story text).
        frames: (story.frames || []).map((f) => ({ alt: "", image: f.image, text: f.text })),
      });
    }
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
    if (storyFileEntry && storyFileEntry.local) {
      return Promise.resolve(storyFileEntry.local.title || "");
    }
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

  // Matches the autonym, the English name, alternate names and the code
  // (data-search on the row), so "Swahili" finds Kiswahili and "Hindi"
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
    const bundle = localFor(entry);
    if (bundle) {
      // Shape matches the remote listing: the reader only reads `.num`, and
      // the local story rides along so loadStoryFrames needs no second lookup.
      return Promise.resolve(
        bundle.stories.map((s) => ({ num: s.num, local: s, file: { name: String(s.num) } }))
      );
    }
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
    // Per-story audio is in the local bundle already; seeding it here means
    // the player works without waiting on (or needing) the release lookup
    // below, which is only still made for the YouTube embed and the PDF link.
    (localFor(entry) ? localFor(entry).stories : []).forEach((s) => {
      if (s.audio) audioByStory[s.num] = { name: s.audio, browser_download_url: s.audio };
    });
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

    // Consume the ?story= deep link now, not when the file list resolves —
    // otherwise opening another language before the first resolves would
    // apply it to the wrong language.
    const wantedStory = initialStory;
    initialStory = null;
    fetchStoryFiles(entry).then((files) => {
      storyFiles = files;
      maxStory = storyFiles.length || 1;
      if (wantedStory && storyFiles.some((s) => s.num === wantedStory)) current = wantedStory;
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
  window.OBSReader = {
    /**
     * Render the reader for one language into `el`.
     * Returns a promise that settles when the catalog call has resolved.
     */
    mount(el, code, opts) {
      const o = opts || {};
      initialStory =
        Number.isFinite(o.initialStory) && o.initialStory >= 1 && o.initialStory <= 50
          ? o.initialStory
          : null;
      const strings = o.strings || {};
      el.innerHTML =
        '<p style="color:#4a5960;">' + escapeHtml(strings.loading || "Loading\u2026") + "</p>";

      // Prefer this site's own copy of the stories: one same-origin request
      // instead of a catalog lookup plus a repo listing plus 50 title
      // fetches, and it keeps working when Door43 does not. Falls back to the
      // live catalog when the endpoint is absent — a build made during a
      // Door43 outage emits no story text at all.
      return fetch("/l/" + encodeURIComponent(code) + "/stories.json")
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null)
        .then((bundle) => {
          if (bundle && bundle.entries && bundle.entries.length && bundle.stories && bundle.stories.length) {
            local = bundle;
            el.innerHTML = "";
            renderLanguageBody(bundle.entries, el);
            return;
          }
          local = null;
          return fetch(LANG_CATALOG_URL + encodeURIComponent(code))
            .then((res) => res.json())
            .then((data) => {
              const group = (data.data || []).filter(
                (e) => !/theological formation/i.test(e.title || "")
              );
              if (group.length === 0) throw new Error("no catalog entry for " + code);
              el.innerHTML = "";
              renderLanguageBody(group, el);
            });
        })
        .catch(() => {
          // The hub around this reader is static: the downloads, the story
          // list and the story pages all still work, so say what is actually
          // unavailable rather than implying the page is broken.
          el.innerHTML =
            '<p style="color:#4a5960;">' +
            escapeHtml(
              strings.offline ||
                "Reading online isn't available right now (Door43 can't be reached). The downloads and story pages above still work."
            ) +
            "</p>";
        });
    },
  };
})();
