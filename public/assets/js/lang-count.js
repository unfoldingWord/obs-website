// Live language counter, shared by the homepage and Why OBS page.
//
// The element (#lang-count) ships with its fallback number rendered as real
// text (and mirrored in data-target) — never a literal "0" in the markup.
// Anyone with JS off, a print/PDF export, a social-preview crawler, or a
// screenshot sees a sensible number instead of "0 languages". The fallback
// lives in the markup in exactly one place per page and both pages use this
// one script, so the two can't drift apart the way the old inline copies
// did (198 vs 213).
//
// When JS *is* running (and the visitor hasn't asked for reduced motion),
// the count-up from 0 is restored as a progressive enhancement: the script
// zeroes the number immediately at load — long before the stat scrolls into
// view — so the visitor still gets the full 0 → N animation the section was
// designed around, without "0" ever being the served markup.
//
// The live count comes from the DCS catalog's stats-ext endpoint (computed
// server-side, so it stays in sync with what's actually published, without
// shipping the full catalog payload just for a number). The animation runs
// only when BOTH the element has scrolled into view AND the live number has
// resolved (or the fetch has failed and the fallback stands in) — so the
// visitor never watches a stale number settle in first.
(function () {
  var countEl = document.getElementById("lang-count");
  if (!countEl) return;

  var fallbackTarget = parseInt(countEl.dataset.target, 10);
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var liveTarget = null; // unknown until the fetch settles (success or failure)
  var intersected = false;
  var animated = false;

  // JS is running, so the count-up will happen — start the display at 0 now,
  // while the stat is still (almost certainly) below the fold. Skipped under
  // prefers-reduced-motion, where the rendered fallback stays put and only
  // the final value is swapped in.
  if (!reduceMotion) countEl.textContent = "0";

  function animateCount(el, target) {
    if (reduceMotion) {
      el.textContent = target;
      return;
    }
    var duration = 1400;
    var start = performance.now();
    function tick(now) {
      // Clamp at 0 too: rAF hands the callback the frame's start timestamp,
      // which can precede the performance.now() captured above — an
      // unclamped first frame briefly renders a negative number.
      var progress = Math.min(Math.max((now - start) / duration, 0), 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(eased * target);
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function maybeAnimate() {
    if (animated || !intersected || liveTarget === null) return;
    animated = true;
    animateCount(countEl, liveTarget);
  }

  var observer = new IntersectionObserver(
    function (entries) {
      if (entries[0].isIntersecting) {
        intersected = true;
        maybeAnimate();
        observer.disconnect();
      }
    },
    { threshold: 0.4 }
  );
  observer.observe(countEl);

  fetch("https://git.door43.org/api/v1/catalog/stats-ext?subject=Open%20Bible%20Stories&stage=prod")
    .then(function (res) { return res.json(); })
    .then(function (stats) {
      var count = stats && stats.lang_count;
      liveTarget = Number.isFinite(count) && count > 0 ? count : fallbackTarget;
      countEl.dataset.target = liveTarget;
      maybeAnimate();
    })
    .catch(function () {
      // Endpoint unreachable — count up to the fallback instead, so the
      // display (zeroed above) never stays stuck at "0".
      liveTarget = fallbackTarget;
      maybeAnimate();
    });
})();
