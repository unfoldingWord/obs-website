(function () {
  const tabBtns = document.querySelectorAll(".page-tab");
  if (tabBtns.length === 0) return;

  function activate(tabName) {
    tabBtns.forEach((btn) => {
      const isActive = btn.dataset.tab === tabName;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
      const panel = document.getElementById(`tab-panel-${btn.dataset.tab}`);
      if (panel) panel.hidden = !isActive;
    });
  }

  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      activate(btn.dataset.tab);
      history.replaceState(null, "", btn.dataset.tab === "howto" ? location.pathname : `#${btn.dataset.tab}`);
    });
  });

  // Deep link support: /translate/#resources opens straight to that tab, and
  // so does /translate/#<language-code> (e.g. a link straight to a language's
  // resources) — resources.js reads the same hash afterward to open that
  // language's detail view once its data has loaded.
  const initial = location.hash.replace("#", "");
  if (initial && initial !== "howto") {
    activate("resources");
  }
})();
