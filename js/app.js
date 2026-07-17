/**
 * More Life Chinese — library shell
 * Loads ./data/vocab.json, filters/renders list + detail, tab + hash routing.
 * Exposes window.App = { cards, filtered, filters, keywords, posList, counts }
 * Study UI is owned by js/cards.js (Cards.init / startSession).
 */
(function () {
  "use strict";

  const VOCAB_URL = "./data/vocab.json";

  /** @type {{ cards: any[], filtered: any[], filters: object, keywords: string[], posList: string[], counts: object }} */
  const App = {
    cards: [],
    filtered: [],
    filters: {
      search: "",
      status: "all",
      pos: "",
      keyword: "",
    },
    keywords: [],
    posList: [],
    counts: { total: 0, learning: 0, known: 0 },
  };

  window.App = App;

  const THEME_KEYWORDS = [
    "food",
    "emotion",
    "work",
    "relationship",
    "internet",
    "travel",
    "body",
    "time",
    "daily-life",
    "idiom",
  ];

  const els = {
    search: document.getElementById("search-input"),
    statusFilters: document.getElementById("status-filters"),
    posFilter: document.getElementById("pos-filter"),
    keywordChips: document.getElementById("keyword-chips"),
    filtersToggle: document.getElementById("filters-toggle"),
    filtersPanel: document.getElementById("filters-panel"),
    stats: document.getElementById("stats-line"),
    list: document.getElementById("card-list"),
    detail: document.getElementById("card-detail"),
    detailBody: document.getElementById("detail-body"),
    viewLibrary: document.getElementById("view-library"),
    viewStudy: document.getElementById("view-study"),
    viewProgress: document.getElementById("view-progress"),
    tabs: document.querySelectorAll(".tab-bar .tab"),
    loading: document.getElementById("loading-banner"),
    error: document.getElementById("error-banner"),
  };

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalize(s) {
    return String(s ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function setLoading(on) {
    if (!els.loading) return;
    els.loading.hidden = !on;
  }

  function setError(msg) {
    if (!els.error) return;
    if (msg) {
      els.error.hidden = false;
      els.error.textContent = msg;
    } else {
      els.error.hidden = true;
      els.error.textContent = "";
    }
  }

  function applyFilters() {
    const q = normalize(App.filters.search.trim());
    const { status, pos, keyword } = App.filters;

    App.filtered = App.cards.filter((card) => {
      if (status !== "all" && card.status !== status) return false;
      if (pos && card.pos !== pos) return false;
      if (keyword) {
        const kws = Array.isArray(card.keywords) ? card.keywords : [];
        if (!kws.includes(keyword)) return false;
      }
      if (!q) return true;

      const hay = [
        card.hanzi,
        card.pinyin,
        card.gloss,
        card.pos,
        ...(Array.isArray(card.keywords) ? card.keywords : []),
      ]
        .map(normalize)
        .join(" ");

      return hay.includes(q);
    });

    renderList();
    renderStats();
  }

  function renderStats() {
    if (!els.stats) return;
    const shown = App.filtered.length;
    const { total, learning, known } = App.counts;
    const parts = [`${shown} shown`];
    if (total) parts.push(`${total} total`);
    if (learning || known) parts.push(`${learning} learning · ${known} known`);
    els.stats.textContent = parts.join(" · ");
  }

  function renderList() {
    if (!els.list) return;
    if (!App.filtered.length) {
      els.list.innerHTML = `<p class="list-empty">No words match these filters.</p>`;
      return;
    }

    const frag = document.createDocumentFragment();
    for (const card of App.filtered) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "list-row";
      btn.setAttribute("role", "listitem");
      btn.dataset.id = card.id;
      btn.innerHTML = `
        <span class="list-hanzi">${escapeHtml(card.hanzi)}${
          card.audio
            ? '<span class="list-audio-dot" title="Has audio" aria-hidden="true"></span>'
            : ""
        }</span>
        <span class="badge badge-${escapeHtml(card.status)}">${escapeHtml(card.status)}</span>
        <span class="list-pinyin">${escapeHtml(card.pinyin)}</span>
        <span class="list-gloss">${escapeHtml(card.gloss)}</span>
      `;
      btn.addEventListener("click", () => openDetail(card.id));
      frag.appendChild(btn);
    }
    els.list.replaceChildren(frag);
  }

  function renderPosOptions() {
    if (!els.posFilter) return;
    const current = App.filters.pos;
    els.posFilter.innerHTML = `<option value="">All POS</option>`;
    for (const p of App.posList) {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      els.posFilter.appendChild(opt);
    }
    els.posFilter.value = current || "";
  }

  function renderKeywordChips() {
    if (!els.keywordChips) return;
    els.keywordChips.replaceChildren();

    const available = new Set(App.keywords);
    const chips = THEME_KEYWORDS.filter((k) => available.has(k));
    if (App.filters.keyword && !chips.includes(App.filters.keyword)) {
      chips.unshift(App.filters.keyword);
    }

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "chip chip-keyword" + (App.filters.keyword ? "" : " is-active");
    clear.textContent = "All topics";
    clear.addEventListener("click", () => setKeywordFilter(""));
    els.keywordChips.appendChild(clear);

    for (const kw of chips) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className =
        "chip chip-keyword" + (App.filters.keyword === kw ? " is-active" : "");
      chip.textContent = kw;
      chip.addEventListener("click", () =>
        setKeywordFilter(App.filters.keyword === kw ? "" : kw)
      );
      els.keywordChips.appendChild(chip);
    }
  }

  function isWideLayout() {
    return window.matchMedia("(min-width: 900px)").matches;
  }

  function setFiltersOpen(open) {
    if (!els.filtersPanel || !els.filtersToggle) return;
    const forceOpen = isWideLayout();
    const next = forceOpen ? true : open;
    els.filtersPanel.hidden = !next;
    els.filtersToggle.setAttribute("aria-expanded", next ? "true" : "false");
    els.filtersToggle.classList.toggle("is-open", next);
  }

  function syncLayoutMode() {
    document.documentElement.classList.toggle("layout-wide", isWideLayout());
    if (isWideLayout()) setFiltersOpen(true);
  }

  function setKeywordFilter(keyword) {
    App.filters.keyword = keyword || "";
    renderKeywordChips();
    applyFilters();
    if (keyword) setFiltersOpen(true);
  }

  function setPosFilter(pos) {
    App.filters.pos = pos || "";
    if (els.posFilter) els.posFilter.value = App.filters.pos;
    applyFilters();
    if (pos) setFiltersOpen(true);
  }

  function filterByTopic(topic) {
    App.filters.status = "all";
    App.filters.pos = "";
    if (els.posFilter) els.posFilter.value = "";
    els.statusFilters?.querySelectorAll(".chip-status").forEach((c) => {
      c.classList.toggle("is-active", c.dataset.status === "all");
    });
    setKeywordFilter(topic || "");
    closeDetail();
    showTab("library");
    history.replaceState(null, "", "#library");
  }

  function filterByPos(pos) {
    App.filters.status = "all";
    App.filters.keyword = "";
    renderKeywordChips();
    els.statusFilters?.querySelectorAll(".chip-status").forEach((c) => {
      c.classList.toggle("is-active", c.dataset.status === "all");
    });
    setPosFilter(pos || "");
    closeDetail();
    showTab("library");
    history.replaceState(null, "", "#library");
  }

  function recomputeCounts() {
    if (window.StatusStore) {
      App.counts = window.StatusStore.counts(App.cards);
    } else {
      App.counts = {
        total: App.cards.length,
        learning: App.cards.filter((c) => c.status === "learning").length,
        known: App.cards.filter((c) => c.status === "known").length,
      };
    }
  }

  function setCardStatus(id, status) {
    const card = App.cards.find((c) => c.id === id);
    if (!card || !window.StatusStore) return;
    window.StatusStore.setCardStatus(card, status);
    recomputeCounts();
    applyFilters();
    if (window.Progress && typeof window.Progress.render === "function") {
      const progressView = document.getElementById("view-progress");
      if (progressView && !progressView.hidden) window.Progress.render();
    }
    openDetail(id);
  }

  function openDetail(id) {
    const card = App.cards.find((c) => c.id === id);
    if (!card || !els.detail || !els.detailBody) return;

    const kws = Array.isArray(card.keywords) ? card.keywords : [];
    const kwHtml = kws
      .map(
        (k) =>
          `<button type="button" class="chip chip-keyword" data-kw="${escapeHtml(k)}">${escapeHtml(k)}</button>`
      )
      .join("");

    const exampleBlock =
      card.example || card.exampleEn || card.examplePinyin
        ? `<div class="detail-section">
            <h3>Example</h3>
            ${card.example ? `<p class="detail-example">${escapeHtml(card.example)}</p>` : ""}
            ${card.examplePinyin ? `<p class="detail-example-pinyin">${escapeHtml(card.examplePinyin)}</p>` : ""}
            ${card.exampleEn ? `<p class="detail-example-en">${escapeHtml(card.exampleEn)}</p>` : ""}
          </div>`
        : "";

    const detailsBlock = card.detailsHtml
      ? `<div class="detail-section">
          <h3>Notes</h3>
          <div class="detail-details">${card.detailsHtml}</div>
        </div>`
      : "";

    const isKnown = card.status === "known";
    const statusAction = isKnown
      ? `<button type="button" class="btn btn-secondary btn-block" id="detail-status-btn" data-next="learning">Mark as learning</button>`
      : `<button type="button" class="btn btn-primary btn-block" id="detail-status-btn" data-next="known">Mark as known</button>`;

    const audioLabel = card.audio ? "Play audio" : "Play pronunciation";
    els.detailBody.innerHTML = `
      <h2 id="detail-hanzi" class="detail-hanzi">${escapeHtml(card.hanzi)}</h2>
      <p class="detail-pinyin">${escapeHtml(card.pinyin)}</p>
      <div class="detail-meta">
        <span class="badge badge-${escapeHtml(card.status)}">${escapeHtml(card.status)}</span>
        <span class="detail-pos">${escapeHtml(card.pos || "")}</span>
        <button type="button" class="btn-audio" id="detail-audio" aria-label="${audioLabel}" title="${audioLabel}">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 010 7"/><path d="M18 6a8 8 0 010 12"/></svg>
          <span>Listen</span>
        </button>
      </div>
      <p class="detail-gloss">${escapeHtml(card.gloss)}</p>
      <div class="detail-status-actions">${statusAction}</div>
      ${exampleBlock}
      <div class="detail-section">
        <h3>Keywords</h3>
        <div class="detail-keywords">${kwHtml || "<span class='detail-pos'>None</span>"}</div>
      </div>
      ${detailsBlock}
    `;

    els.detailBody.querySelectorAll("[data-kw]").forEach((btn) => {
      btn.addEventListener("click", () => {
        closeDetail();
        setKeywordFilter(btn.getAttribute("data-kw") || "");
        showTab("library");
      });
    });

    const audioBtn = document.getElementById("detail-audio");
    audioBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (window.VocabAudio) window.VocabAudio.play(card);
    });

    const statusBtn = document.getElementById("detail-status-btn");
    statusBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      const next = statusBtn.getAttribute("data-next") || "known";
      setCardStatus(card.id, next);
    });

    els.detail.hidden = false;
    els.detail.setAttribute("aria-hidden", "false");
    // Bottom sheet locks scroll; side panel on wide layouts does not
    document.body.style.overflow = isWideLayout() ? "" : "hidden";

    if (location.hash !== `#word/${id}`) {
      history.replaceState(null, "", `#word/${id}`);
    }
  }

  function closeDetail() {
    if (!els.detail) return;
    els.detail.hidden = true;
    els.detail.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (location.hash.startsWith("#word/")) {
      history.replaceState(null, "", "#library");
    }
  }

  function showTab(name) {
    const tab = name === "study" || name === "progress" ? name : "library";
    // Re-query in case els were stale
    const viewLibrary = els.viewLibrary || document.getElementById("view-library");
    const viewStudy = els.viewStudy || document.getElementById("view-study");
    const viewProgress = els.viewProgress || document.getElementById("view-progress");
    els.viewLibrary = viewLibrary;
    els.viewStudy = viewStudy;
    els.viewProgress = viewProgress;

    if (viewLibrary) {
      viewLibrary.hidden = tab !== "library";
      viewLibrary.style.display = tab === "library" ? "" : "none";
    }
    if (viewStudy) {
      viewStudy.hidden = tab !== "study";
      viewStudy.style.display = tab === "study" ? "" : "none";
    }
    if (viewProgress) {
      viewProgress.hidden = tab !== "progress";
      viewProgress.style.display = tab === "progress" ? "" : "none";
      if (tab === "progress") {
        viewProgress.removeAttribute("hidden");
        viewProgress.style.display = "block";
      }
    }

    document.querySelectorAll(".tab-bar .tab").forEach((t) => {
      t.classList.toggle("is-active", t.dataset.tab === tab);
    });

    if (tab === "progress") {
      requestAnimationFrame(() => {
        if (window.Progress && typeof window.Progress.render === "function") {
          window.Progress.render();
        }
      });
    }

    const desired = "#" + tab;
    if (!location.hash.startsWith("#word/") && location.hash !== desired) {
      history.replaceState(null, "", desired);
    }
  }

  function parseHash() {
    const hash = (location.hash || "#library").slice(1);
    if (hash.startsWith("word/")) {
      showTab("library");
      const id = decodeURIComponent(hash.slice(5));
      if (App.cards.length) openDetail(id);
      return;
    }
    if (hash === "study") {
      closeDetail();
      showTab("study");
      return;
    }
    if (hash === "progress") {
      closeDetail();
      showTab("progress");
      return;
    }
    closeDetail();
    showTab("library");
  }

  function wireEvents() {
    let searchTimer = null;
    els.search?.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        App.filters.search = els.search.value;
        applyFilters();
      }, 120);
    });

    els.statusFilters?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-status]");
      if (!btn) return;
      App.filters.status = btn.dataset.status || "all";
      els.statusFilters.querySelectorAll(".chip-status").forEach((c) => {
        c.classList.toggle("is-active", c === btn);
      });
      applyFilters();
    });

    els.posFilter?.addEventListener("change", () => {
      App.filters.pos = els.posFilter.value;
      applyFilters();
    });

    els.filtersToggle?.addEventListener("click", () => {
      if (isWideLayout()) return;
      const open = els.filtersToggle.getAttribute("aria-expanded") !== "true";
      setFiltersOpen(open);
    });

    els.detail?.addEventListener("click", (e) => {
      if (e.target.closest("[data-close-detail]")) closeDetail();
    });

    let resizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(syncLayoutMode, 100);
    });
    window.addEventListener("orientationchange", () => setTimeout(syncLayoutMode, 150));

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && els.detail && !els.detail.hidden) {
        closeDetail();
      }
    });

    els.tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const name = tab.dataset.tab || "library";
        closeDetail();
        showTab(name);
        history.replaceState(null, "", "#" + name);
      });
    });

    window.addEventListener("hashchange", parseHash);
  }

  function initStudyModules() {
    try {
      if (window.Cards && typeof window.Cards.init === "function") {
        window.Cards.init();
      }
    } catch (err) {
      console.warn("Cards.init failed (study module may load later):", err);
    }
    try {
      if (window.Progress && typeof window.Progress.init === "function") {
        window.Progress.init();
      }
      if (window.Progress && typeof window.Progress.render === "function") {
        window.Progress.render();
      }
    } catch (err) {
      console.warn("Progress.init failed:", err);
    }
  }

  async function loadVocab() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(VOCAB_URL, { cache: "no-cache" });
      if (!res.ok) throw new Error(`Failed to load vocab (${res.status})`);
      const data = await res.json();
      App.cards = Array.isArray(data.cards) ? data.cards : [];
      if (window.StatusStore) {
        window.StatusStore.applyToCards(App.cards);
      }
      App.keywords = Array.isArray(data.keywords)
        ? data.keywords
        : [...new Set(App.cards.flatMap((c) => c.keywords || []))].sort();
      App.posList = Array.isArray(data.posList)
        ? data.posList
        : [...new Set(App.cards.map((c) => c.pos).filter(Boolean))].sort();
      recomputeCounts();

      renderPosOptions();
      renderKeywordChips();
      applyFilters();
      initStudyModules();
      parseHash();
    } catch (err) {
      console.error(err);
      setError(
        err.message ||
          "Could not load vocabulary. Run the rebuild script to generate data/vocab.json."
      );
      if (els.list) {
        els.list.innerHTML = `<p class="list-error">Vocabulary data missing or unreadable.</p>`;
      }
      if (els.stats) els.stats.textContent = "0 words";
    } finally {
      setLoading(false);
    }
  }

  // Public helpers for other modules
  App.setKeywordFilter = setKeywordFilter;
  App.setPosFilter = setPosFilter;
  App.filterByTopic = filterByTopic;
  App.filterByPos = filterByPos;
  App.setCardStatus = setCardStatus;
  App.recomputeCounts = recomputeCounts;
  App.openDetail = openDetail;
  App.showTab = showTab;
  App.applyFilters = applyFilters;

  wireEvents();
  syncLayoutMode();
  showTab("library");
  loadVocab();
})();
