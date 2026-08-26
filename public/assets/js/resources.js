(function () {
  // ---------- what we're indexing ----------
  //
  // Redesigned from "one long list per resource type" (5 stacked lists, each
  // repeating every language) to "one list of languages, expand to see what's
  // available for that language" — the same search-then-expand pattern
  // already used on Discover and Library, so a visitor only has to learn one
  // interaction on this whole site, not a different one per page.
  const RESOURCE_TYPES = [
    {
      key: "tn",
      subject: "OBS Translation Notes",
      label: "Translation Notes",
      badge: "Notes",
      description:
        "Term-by-term notes explaining difficult words, phrases, and cultural or theological concepts within each story — written to help a translator render them accurately.",
    },
    {
      key: "tq",
      subject: "OBS Translation Questions",
      label: "Translation Questions",
      badge: "Questions",
      description:
        "Comprehension questions and answers for each story, used to check whether a translation communicates the right meaning — part of the standard checking process.",
    },
    {
      key: "sn",
      subject: "OBS Study Notes",
      label: "Study Notes",
      badge: "Study Notes",
      description:
        "The same kind of term explanations as Translation Notes, framed for personal or group Bible study rather than the translation-checking process.",
    },
    {
      key: "sq",
      subject: "OBS Study Questions",
      label: "Study Questions",
      badge: "Study Qs",
      description:
        "Comprehension questions for group or personal study, the same style as Translation Questions but for a study setting.",
    },
    {
      key: "tf",
      subject: null, // special-cased: see fetchExtendedEditions()
      label: "Extended Edition (Theological Formation)",
      badge: "Extended",
      description:
        "The same 50 stories, with added theological commentary and training content layered in: a key idea, a creedal connection, and discipleship-focused notes alongside each story.",
    },
  ];

  const searchEl = document.getElementById("res-search");
  const statusEl = document.getElementById("res-status");
  const listEl = document.getElementById("res-lang-list");
  const detailEl = document.getElementById("res-lang-detail");
  const browseEl = document.getElementById("res-browse");

  if (!listEl) return; // resources.js is also loaded standalone; no-op if this markup isn't on the page

  let languages = []; // [{code, title, resources: {tn:[entries], tq:[...], ...}}]

  // ---------- shared helpers (same content-reading logic as before) ----------

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function renderObsMarkdown(md) {
    const withoutFrontmatter = md.replace(/^---\n[\s\S]*?\n---\n/, "");
    const blocks = withoutFrontmatter
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter(Boolean);

    return blocks
      .map((block) => {
        const headingMatch = block.match(/^(#{1,6})\s*(.*)$/);
        if (headingMatch) {
          const level = Math.min(headingMatch[1].length + 3, 6);
          return `<h${level} style="color:var(--ocean); margin:10px 0 6px;">${escapeHtml(
            headingMatch[2]
          )}</h${level}>`;
        }
        const img = block.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
        if (img) {
          return `<img src="${img[2]}" alt="${escapeHtml(
            img[1]
          )}" loading="lazy" style="width:100%; max-width:360px; border-radius:8px; margin:8px 0; display:block;">`;
        }
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
          return `<ul style="margin:0 0 8px 20px; padding:0; color:var(--tech); font-size:0.92rem;">${items}</ul>`;
        }
        return `<p style="color:var(--tech); font-size:0.92rem; margin-bottom:8px;">${escapeHtml(
          block
        )}</p>`;
      })
      .join("");
  }

  function contentPathFor(entry) {
    const ing = entry.ingredients && entry.ingredients[0];
    if (!ing || !ing.path) return "content";
    return ing.path.replace(/^\.\/?/, "").replace(/\/$/, "");
  }

  function contentsApiUrl(entry, subPath) {
    const contentPath = contentPathFor(entry);
    const full = [contentPath, subPath].filter(Boolean).join("/");
    return `https://git.door43.org/api/v1/repos/${entry.owner}/${entry.name}/contents/${full}?ref=${entry.branch_or_tag_name}`;
  }

  function rawUrl(entry, path) {
    return `https://git.door43.org/${entry.owner}/${entry.name}/raw/${entry.branch_or_tag_name}/${path}`;
  }

  function loadPreview(entry, container) {
    container.innerHTML =
      '<p style="color:#4a5960; font-size:0.85rem;">Loading stories...</p>';

    return fetch(contentsApiUrl(entry))
      .then((res) => res.json())
      .then((files) => {
        const storyDirs = (files || []).filter(
          (f) => f.type === "dir" && /^\d+$/.test(f.name)
        );
        const directFiles = (files || [])
          .filter((f) => /\.md$/i.test(f.name) && /\d+/.test(f.name))
          .map((f) => ({
            file: f,
            num: parseInt(f.name.match(/(\d+)/)[0], 10),
          }))
          .sort((a, b) => a.num - b.num);

        if (storyDirs.length > 0) {
          renderNestedStoryList(entry, storyDirs, container);
        } else if (directFiles.length > 0) {
          renderFlatStoryList(entry, directFiles, container);
        } else {
          container.innerHTML = `
            <p style="color:#4a5960; font-size:0.85rem;">
              Couldn't find a readable structure for this one automatically.
              <a href="https://git.door43.org/${entry.owner}/${entry.name}" style="color:var(--inspire);">View the raw files on Door43</a>.
            </p>`;
        }
      })
      .catch(() => {
        container.innerHTML =
          '<p style="color:#4a5960; font-size:0.85rem;">Couldn\'t load this preview right now.</p>';
      });
  }

  function renderFlatStoryList(entry, directFiles, container) {
    container.innerHTML = `
      <p style="color:#4a5960; font-size:0.85rem; margin-bottom:10px;">${directFiles.length} stories</p>
      <div class="flat-story-list" style="display:flex; flex-direction:column; gap:2px;"></div>
    `;
    const listEl = container.querySelector(".flat-story-list");

    listEl.innerHTML = directFiles
      .map(
        ({ file, num }) => `
        <div class="flat-story-item" data-filename="${escapeHtml(
          file.name
        )}" style="border-bottom:1px solid rgba(1,66,99,0.06); padding:8px 4px;">
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="width:24px; height:24px; border-radius:6px; background:var(--panel); display:flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; color:var(--ocean); flex:none;">${num}</div>
            <button class="flat-read-btn btn btn-outline" style="padding:4px 12px; font-size:0.78rem;">Read</button>
          </div>
          <div class="flat-text" hidden style="margin-top:10px; padding-left:34px;"></div>
        </div>`
      )
      .join("");

    listEl.querySelectorAll(".flat-story-item").forEach((item) => {
      const filename = item.dataset.filename;
      const btn = item.querySelector(".flat-read-btn");
      const textEl = item.querySelector(".flat-text");

      btn.addEventListener("click", () => {
        const isOpen = !textEl.hidden;
        if (isOpen) {
          textEl.hidden = true;
          btn.textContent = "Read";
          return;
        }
        if (textEl.dataset.loaded === "true") {
          textEl.hidden = false;
          btn.textContent = "Hide";
          return;
        }
        btn.textContent = "Loading...";
        const path = [contentPathFor(entry), filename].filter(Boolean).join("/");
        fetch(rawUrl(entry, path))
          .then((res) => (res.ok ? res.text() : Promise.reject()))
          .then((md) => {
            textEl.innerHTML = renderObsMarkdown(md);
            textEl.dataset.loaded = "true";
            textEl.hidden = false;
            btn.textContent = "Hide";
          })
          .catch(() => {
            textEl.innerHTML =
              '<p style="color:#b23; font-size:0.85rem;">Couldn\'t load this right now.</p>';
            textEl.hidden = false;
            btn.textContent = "Hide";
          });
      });
    });
  }

  function renderNestedStoryList(entry, storyDirs, container) {
    const sorted = storyDirs
      .map((d) => ({ dir: d, num: parseInt(d.name, 10) }))
      .sort((a, b) => a.num - b.num);

    container.innerHTML = `
      <p style="color:#4a5960; font-size:0.85rem; margin-bottom:10px;">${sorted.length} stories &mdash; pick one to see its notes</p>
      <div class="story-num-picker" style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:14px;"></div>
      <div class="story-items"></div>
    `;

    const pickerEl = container.querySelector(".story-num-picker");
    const itemsEl = container.querySelector(".story-items");

    pickerEl.innerHTML = sorted
      .map(
        ({ num }, i) =>
          `<button class="filter-chip story-num-btn${
            i === 0 ? " active" : ""
          }" data-num="${num}" style="padding:6px 12px; font-size:0.78rem;">${num}</button>`
      )
      .join("");

    function loadStoryItems(num) {
      itemsEl.innerHTML =
        '<p style="color:#4a5960; font-size:0.85rem;">Loading...</p>';
      fetch(contentsApiUrl(entry, String(num).padStart(2, "0")))
        .then((res) => res.json())
        .then((files) => {
          const items = (files || [])
            .filter((f) => /\.md$/i.test(f.name))
            .sort((a, b) => a.name.localeCompare(b.name));

          if (items.length === 0) {
            itemsEl.innerHTML =
              '<p style="color:#4a5960; font-size:0.85rem;">Nothing here for this story.</p>';
            return;
          }

          itemsEl.innerHTML = items
            .map(
              (f, i) => `
              <div class="note-item" data-path="${escapeHtml(
                f.path
              )}" style="border-bottom:1px solid rgba(1,66,99,0.06); padding:8px 4px;">
                <button class="note-read-btn btn btn-outline" style="padding:4px 12px; font-size:0.78rem;">Note ${
                  i + 1
                }</button>
                <div class="note-text" hidden style="margin-top:10px;"></div>
              </div>`
            )
            .join("");

          itemsEl.querySelectorAll(".note-item").forEach((item) => {
            const path = item.dataset.path;
            const btn = item.querySelector(".note-read-btn");
            const textEl = item.querySelector(".note-text");

            btn.addEventListener("click", () => {
              const isOpen = !textEl.hidden;
              if (isOpen) {
                textEl.hidden = true;
                return;
              }
              if (textEl.dataset.loaded === "true") {
                textEl.hidden = false;
                return;
              }
              fetch(rawUrl(entry, path))
                .then((res) => (res.ok ? res.text() : Promise.reject()))
                .then((md) => {
                  textEl.innerHTML = renderObsMarkdown(md);
                  textEl.dataset.loaded = "true";
                  textEl.hidden = false;
                })
                .catch(() => {
                  textEl.innerHTML =
                    '<p style="color:#b23; font-size:0.85rem;">Couldn\'t load this right now.</p>';
                  textEl.hidden = false;
                });
            });
          });
        })
        .catch(() => {
          itemsEl.innerHTML =
            '<p style="color:#4a5960; font-size:0.85rem;">Couldn\'t load this story\'s notes right now.</p>';
        });
    }

    pickerEl.querySelectorAll(".story-num-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        pickerEl
          .querySelectorAll(".story-num-btn")
          .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        loadStoryItems(parseInt(btn.dataset.num, 10));
      });
    });

    loadStoryItems(sorted[0].num);
  }

  // ---------- fetching + indexing ----------

  // Every fetch here resolves (never rejects) so one failing resource type
  // can't take down the other four — but it resolves to {ok, entries} rather
  // than swallowing the failure into a bare [], so the caller can tell "this
  // type genuinely has zero entries" apart from "this type's request failed"
  // and, if EVERY type failed, show a real error instead of a misleading
  // "no languages match" empty state.
  function fetchSubjectRaw(subject) {
    const url = `https://git.door43.org/api/v1/catalog/search?subject=${encodeURIComponent(
      subject
    )}&stage=prod`;
    return fetch(url)
      .then((res) => res.json())
      .then((data) => ({ ok: true, entries: data.data || [] }))
      .catch(() => ({ ok: false, entries: [] }));
  }

  // Extended Editions aren't reliably filed under subject "Open Bible
  // Stories" — verified directly against the live catalog API: English's own
  // unfoldingWord/en_obs_tf carries a distinct subject, "OBS Theological
  // Formation", not "Open Bible Stories". Querying both and merging (deduped
  // by owner/name) surfaces today's entries and stays correct if a future
  // edition is ever catalogued either way.
  function fetchExtendedEditions() {
    return Promise.all([
      fetchSubjectRaw("Open Bible Stories"),
      fetchSubjectRaw("OBS Theological Formation"),
    ]).then(([bySubject, byTfSubject]) => {
      const fromMainSubject = bySubject.entries.filter((e) =>
        /theological formation/i.test(e.title || "")
      );
      const seen = new Set();
      const merged = [...fromMainSubject, ...byTfSubject.entries].filter((e) => {
        const key = `${e.owner}/${e.name}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      // Only "failed" if BOTH underlying requests failed — either one
      // succeeding is enough to trust the merged (possibly empty) result.
      return { ok: bySubject.ok || byTfSubject.ok, entries: merged };
    });
  }

  function buildLanguageIndex(resultsByType) {
    const byCode = new Map();

    RESOURCE_TYPES.forEach((type, i) => {
      resultsByType[i].entries.forEach((entry) => {
        const code = entry.language;
        if (!byCode.has(code)) {
          byCode.set(code, {
            code,
            title: entry.language_title || code,
            resources: {},
          });
        }
        const row = byCode.get(code);
        if (!row.resources[type.key]) row.resources[type.key] = [];
        row.resources[type.key].push(entry);
      });
    });

    return Array.from(byCode.values()).sort((a, b) =>
      a.title.localeCompare(b.title)
    );
  }

  // ---------- rendering: browse list ----------

  function availableCount(row) {
    return RESOURCE_TYPES.filter((t) => (row.resources[t.key] || []).length > 0)
      .length;
  }

  function badgesFor(row) {
    return RESOURCE_TYPES.filter((t) => (row.resources[t.key] || []).length > 0)
      .map((t) => `<span class="badge">${t.badge}</span>`)
      .join("");
  }

  function renderList() {
    const query = searchEl.value.trim().toLowerCase();
    const filtered = languages.filter(
      (l) =>
        !query ||
        l.title.toLowerCase().includes(query) ||
        l.code.toLowerCase().includes(query)
    );

    if (filtered.length === 0) {
      listEl.innerHTML = "";
      statusEl.textContent = "No languages match that search yet.";
      return;
    }

    statusEl.textContent =
      filtered.length + " of " + languages.length + " languages with at least one resource";

    listEl.innerHTML = filtered
      .map(
        (l) => `
        <div class="lang-row" data-lang="${l.code}" tabindex="0" role="button">
          <div>
            <div class="name">${l.title}</div>
            <div class="code">${l.code} &middot; ${availableCount(l)} of ${RESOURCE_TYPES.length} resources</div>
          </div>
          <div class="badges">${badgesFor(l)}</div>
        </div>`
      )
      .join("");

    listEl.querySelectorAll(".lang-row").forEach((row) => {
      row.addEventListener("click", () => showDetail(row.dataset.lang));
      row.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") showDetail(row.dataset.lang);
      });
    });
  }

  // ---------- rendering: language detail ----------

  function showDetail(code) {
    const row = languages.find((l) => l.code === code);
    if (!row) return;

    browseEl.hidden = true;
    detailEl.hidden = false;
    location.hash = code;

    detailEl.innerHTML = `
      <button id="res-back-btn" class="btn btn-outline" style="margin-bottom:20px; padding:8px 16px; font-size:0.85rem;">&larr; All languages</button>
      <h2 style="color:var(--ocean); margin-bottom:4px;">${row.title}</h2>
      <p style="color:#4a5960; font-size:0.9rem; margin-bottom:28px;">${row.code} &middot; ${availableCount(row)} of ${RESOURCE_TYPES.length} resources available</p>
      <div id="res-type-blocks"></div>
    `;

    document.getElementById("res-back-btn").addEventListener("click", () => {
      browseEl.hidden = false;
      detailEl.hidden = true;
      detailEl.innerHTML = "";
      history.replaceState(null, "", location.pathname + "#resources");
    });

    const blocksEl = document.getElementById("res-type-blocks");
    blocksEl.innerHTML = RESOURCE_TYPES.map(
      (t) => `
      <div class="resource-type-block" style="border-bottom:1px solid rgba(1,66,99,0.08); padding:20px 0;">
        <h3 style="color:var(--ocean); margin-bottom:6px; font-size:1.05rem;">${t.label}</h3>
        <p style="color:#4a5960; font-size:0.88rem; max-width:640px; margin-bottom:14px;">${t.description}</p>
        <div class="resource-type-body" data-type="${t.key}"></div>
      </div>`
    ).join("");

    RESOURCE_TYPES.forEach((t) => {
      const bodyEl = blocksEl.querySelector(`.resource-type-body[data-type="${t.key}"]`);
      const entries = row.resources[t.key] || [];
      renderTypeBody(bodyEl, entries);
    });
  }

  function renderTypeBody(bodyEl, entries) {
    if (entries.length === 0) {
      bodyEl.innerHTML =
        '<p style="color:#4a5960; font-size:0.85rem; font-style:italic;">Not yet available for this language.</p>';
      return;
    }

    if (entries.length === 1) {
      renderSingleEntry(bodyEl, entries[0]);
      return;
    }

    // More than one team has published this type for this language — let the
    // visitor pick which one, rather than guessing and hiding the rest.
    bodyEl.innerHTML = `
      <p style="color:#4a5960; font-size:0.82rem; margin-bottom:8px;">${entries.length} teams have published this &mdash; choose which one:</p>
      <div class="team-picker" style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px;"></div>
      <div class="team-entry"></div>
    `;
    const pickerEl = bodyEl.querySelector(".team-picker");
    const entryEl = bodyEl.querySelector(".team-entry");

    pickerEl.innerHTML = entries
      .map(
        (e, i) =>
          `<button class="filter-chip team-btn${i === 0 ? " active" : ""}" data-idx="${i}" style="padding:6px 14px; font-size:0.78rem;">${escapeHtml(e.owner)}</button>`
      )
      .join("");

    pickerEl.querySelectorAll(".team-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        pickerEl.querySelectorAll(".team-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        renderSingleEntry(entryEl, entries[parseInt(btn.dataset.idx, 10)]);
      });
    });

    renderSingleEntry(entryEl, entries[0]);
  }

  function renderSingleEntry(container, entry) {
    container.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
        <button class="resource-view-btn btn btn-outline" style="padding:6px 14px; font-size:0.8rem;">View</button>
        <a href="${entry.zipball_url}" class="btn btn-outline" style="padding:6px 14px; font-size:0.8rem;">Download</a>
        <span style="color:#4a5960; font-size:0.78rem;">via ${escapeHtml(entry.owner)}</span>
      </div>
      <div class="resource-preview" hidden style="margin-top:14px;"></div>
    `;

    const btn = container.querySelector(".resource-view-btn");
    const previewEl = container.querySelector(".resource-preview");

    btn.addEventListener("click", () => {
      const isOpen = !previewEl.hidden;
      if (isOpen) {
        previewEl.hidden = true;
        btn.textContent = "View";
        return;
      }
      if (previewEl.dataset.loaded === "true") {
        previewEl.hidden = false;
        btn.textContent = "Hide";
        return;
      }
      btn.textContent = "Loading...";
      loadPreview(entry, previewEl).then(() => {
        previewEl.hidden = false;
        previewEl.dataset.loaded = "true";
        btn.textContent = "Hide";
      });
    });
  }

  // ---------- boot ----------

  statusEl.textContent = "Loading resources...";
  searchEl.addEventListener("input", renderList);

  Promise.all(
    RESOURCE_TYPES.map((t) =>
      t.key === "tf" ? fetchExtendedEditions() : fetchSubjectRaw(t.subject)
    )
  )
    .then((resultsByType) => {
      const allFailed = resultsByType.every((r) => !r.ok);
      if (allFailed) {
        statusEl.textContent = "Couldn't load resources right now. Try refreshing.";
        return;
      }

      languages = buildLanguageIndex(resultsByType);
      renderList();

      const hashCode = location.hash.replace("#", "");
      if (hashCode && hashCode !== "resources" && languages.some((l) => l.code === hashCode)) {
        showDetail(hashCode);
      }
    })
    .catch(() => {
      statusEl.textContent = "Couldn't load resources right now. Try refreshing.";
    });
})();
