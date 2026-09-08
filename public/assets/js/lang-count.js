// Language counter animation, shared by the homepage and Why OBS page.
//
// The number itself is NOT fetched here. It is rendered into the markup at
// build time from the DCS catalog snapshot (src/data/catalog.ts) — the same
// source Discover's language list and the meta descriptions use — so every
// page states the same count and nothing at runtime can make them disagree
// (the old live fetch of a different endpoint is how the homepage once
// showed a different number than Discover).
//
// This script is a pure progressive enhancement: when JS runs and the
// visitor hasn't asked for reduced motion, the count is zeroed at load and
// counts back up to the served value once it scrolls into view. With JS off
// (or for crawlers and social previews) the real number is what's in the HTML.
(function () {
  var countEl = document.getElementById("lang-count");
  if (!countEl) return;

  var target = parseInt(countEl.dataset.target, 10);
  if (!Number.isFinite(target) || target <= 0) return;

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion || !("IntersectionObserver" in window)) return;

  // Start at 0 while the stat is still below the fold.
  countEl.textContent = "0";

  function animateCount(el, value) {
    var duration = 1400;
    var start = performance.now();
    function tick(now) {
      // Clamp at 0 too: rAF hands the callback the frame's start timestamp,
      // which can precede the performance.now() captured above — an
      // unclamped first frame briefly renders a negative number.
      var progress = Math.min(Math.max((now - start) / duration, 0), 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(eased * value);
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  var observer = new IntersectionObserver(
    function (entries) {
      if (entries[0].isIntersecting) {
        observer.disconnect();
        animateCount(countEl, target);
      }
    },
    { threshold: 0.4 }
  );
  observer.observe(countEl);
})();
