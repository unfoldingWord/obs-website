// Live language counter, shared by the homepage and Why OBS page.
//
// The element (#lang-count) ships with its fallback number rendered as real
// text (and mirrored in data-target) — never a literal "0". Anyone with JS
// off, a print/PDF export, a social-preview crawler, or a screenshot sees a
// sensible number instead of "0 languages". The fallback lives in the markup
// in exactly one place per page and both pages use this one script, so the
// two can't drift apart the way the old inline copies did (198 vs 213).
//
// The live count comes from the DCS catalog's stats-ext endpoint (computed
// server-side, so it stays in sync with what's actually published, without
// shipping the full catalog payload just for a number). The count-up
// animation runs only when BOTH the element has scrolled into view AND the
// live number has resolved — so the visitor never watches the stale
// fallback settle in first, and never sees an animation from a cold "0".
(function () {
  var countEl = document.getElementById("lang-count");
  if (!countEl) return;

  var fallbackTarget = parseInt(countEl.dataset.target, 10);
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var liveTarget = null; // unknown until the fetch settles (success or failure)
  var intersected = false;
  var animated = false;

  function animateCount(el, from, target) {
    if (reduceMotion || from === target) {
      el.textContent = target;
      return;
    }
    var duration = 1400;
    var start = performance.now();
    function tick(now) {
      var progress = Math.min((now - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(from + eased * (target - from));
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function maybeAnimate() {
    if (animated || !intersected || liveTarget === null) return;
    animated = true;
    animateCount(countEl, fallbackTarget, liveTarget);
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
      // Endpoint unreachable — the fallback is already rendered in the
      // markup, so there is nothing to animate; just stop waiting.
      liveTarget = fallbackTarget;
      maybeAnimate();
    });
})();
