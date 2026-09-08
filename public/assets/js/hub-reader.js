(function () {
  "use strict";
  // Boots the reader on a language hub.
  //
  // The reader is deliberately not loaded on arrival: a hub is mostly read by
  // people who want the downloads or a single story, and mounting it eagerly
  // would fire a Door43 request on all 214 hubs. It opens when someone asks
  // for it — a click, or a #read / #story-N fragment.
  const el = document.getElementById("hub-reader");
  if (!el || !window.OBSReader) return;

  function storyFromHash() {
    const m = location.hash.match(/^#story-(\d+)$/);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return n >= 1 && n <= 50 ? n : null;
  }

  const section = el.closest(".hub-reader");
  let mounted = false;
  function open(story) {
    if (mounted) return;
    mounted = true;
    // The section ships hidden so that with no JS (or no reader script) the
    // hub never shows an empty "Read online" heading.
    if (section) section.hidden = false;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    window.OBSReader.mount(el, el.dataset.lang, {
      initialStory: story,
      strings: { loading: el.dataset.loading, offline: el.dataset.offline },
    });
  }

  // Any link pointing at #read or #story-N opens the reader in place.
  document.addEventListener("click", (ev) => {
    const a = ev.target.closest('a[href^="#read"], a[href^="#story-"]');
    if (!a) return;
    const m = a.getAttribute("href").match(/^#story-(\d+)$/);
    open(m ? parseInt(m[1], 10) : null);
  });

  window.addEventListener("hashchange", () => {
    const s = storyFromHash();
    if (s !== null || location.hash === "#read") open(s);
  });

  // Deep link straight into the reader.
  const initial = storyFromHash();
  if (initial !== null || location.hash === "#read") open(initial);
})();
