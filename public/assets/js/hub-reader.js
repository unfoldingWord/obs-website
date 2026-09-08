(function () {
  "use strict";
  // Boots the reader on a language hub, and turns the hub's story links into
  // reader links.
  //
  // Every "read" affordance on the hub — the Read online / Listen buttons,
  // "Read this story" under the extract, and every row of the story list —
  // points at that story's own page (/l/{code}/story-{n}/). Those are real
  // URLs: they are what search engines follow, what the sitemap lists, and
  // what a visitor without JavaScript gets. This script intercepts the click
  // and opens the story in the reader instead, in place.
  //
  // That is honest progressive enhancement rather than the sleight of hand we
  // removed from Discover: there the href pointed at a fragment that served
  // no content, whereas here the href and the reader show the same story.
  //
  // The reader is not mounted on arrival — a hub is mostly visited for the
  // downloads or one story, and mounting eagerly would fire a Door43 request
  // on all 214 hubs.
  const el = document.getElementById("hub-reader");
  if (!el || !window.OBSReader) return;

  const section = el.closest(".hub-reader");
  const code = el.dataset.lang;
  const STORY_HREF = new RegExp(
    "^/l/" + code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/story-(\\d+)/$"
  );

  function storyFromHash() {
    const m = location.hash.match(/^#story-(\d+)$/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return n >= 1 && n <= 50 ? n : null;
  }

  /** The reader's story picker — the one select it renders that is not the
   *  publisher chooser. Absent until the reader has finished mounting. */
  function storySelect() {
    return Array.prototype.find.call(
      el.querySelectorAll("select"),
      (s) => s.id !== "publisher-select"
    );
  }

  let mounted = false;

  function reveal() {
    if (section) section.hidden = false;
  }

  function open(story) {
    if (mounted) {
      // Already reading — move to the requested story rather than remounting,
      // which would refetch the catalog and lose the reader's place.
      goTo(story);
      return;
    }
    mounted = true;
    reveal();
    window.OBSReader.mount(el, code, {
      initialStory: story,
      strings: { loading: el.dataset.loading, offline: el.dataset.offline },
    }).then(() => scrollToReader());
    scrollToReader();
  }

  function goTo(story) {
    reveal();
    if (story) {
      const sel = storySelect();
      if (sel && String(story) !== sel.value) {
        sel.value = String(story);
        sel.dispatchEvent(new Event("change"));
      }
    }
    scrollToReader();
  }

  function scrollToReader() {
    if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  document.addEventListener("click", (ev) => {
    // Let modified clicks through: someone opening a story in a new tab wants
    // the story page, which is a perfectly good destination.
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    const a = ev.target.closest("a[href]");
    if (!a || a.target === "_blank") return;

    const href = a.getAttribute("href");
    if (href === "#read") {
      ev.preventDefault();
      open(null);
      return;
    }
    const hash = href.match(/^#story-(\d+)$/);
    if (hash) {
      ev.preventDefault();
      open(parseInt(hash[1], 10));
      return;
    }
    // A link to one of this language's story pages.
    const story = a.pathname && a.pathname.match(STORY_HREF);
    if (story && a.origin === location.origin) {
      ev.preventDefault();
      const num = parseInt(story[1], 10);
      open(num);
      // Keep the fragment in step so the story is shareable and Back works.
      if (location.hash !== "#story-" + num) history.pushState(null, "", "#story-" + num);
    }
  });

  // Back/forward between stories, and #story-N deep links from elsewhere.
  window.addEventListener("hashchange", () => {
    const s = storyFromHash();
    if (s !== null || location.hash === "#read") open(s);
  });
  window.addEventListener("popstate", () => {
    const s = storyFromHash();
    if (s !== null && mounted) goTo(s);
  });

  // Landing straight on a story: /l/{code}/#story-7.
  const initial = storyFromHash();
  if (initial !== null || location.hash === "#read") open(initial);
})();
