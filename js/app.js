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
        <span class="list-hanzi">${escapeHtml(card.hanzi)}</span>
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

  function setFiltersOpen(open) {
    if (!els.filtersPanel || !els.filtersToggle) return;
    els.filtersPanel.hidden = !open;
    els.filtersToggle.setAttribute("aria-expanded", open ? "true" : "false");
    els.filtersToggle.classList.toggle("is-open", open);
  }

  function setKeywordFilter(keyword) {
    App.filters.keyword = keyword || "";
    renderKeywordChips();
    applyFilters();
    if (keyword) setFiltersOpen(true);
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

    els.detailBody.innerHTML = `
      <h2 id="detail-hanzi" class="detail-hanzi">${escapeHtml(card.hanzi)}</h2>
      <p class="detail-pinyin">${escapeHtml(card.pinyin)}</p>
      <div class="detail-meta">
        <span class="badge badge-${escapeHtml(card.status)}">${escapeHtml(card.status)}</span>
        <span class="detail-pos">${escapeHtml(card.pos || "")}</span>
      </div>
      <p class="detail-gloss">${escapeHtml(card.gloss)}</p>
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

    els.detail.hidden = false;
    els.detail.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

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
    const isLibrary = name === "library";
    if (els.viewLibrary) els.viewLibrary.hidden = !isLibrary;
    if (els.viewStudy) els.viewStudy.hidden = isLibrary;

    els.tabs.forEach((tab) => {
      tab.classList.toggle("is-active", tab.dataset.tab === name);
    });

    const desired = isLibrary ? "#library" : "#study";
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
      const open = els.filtersToggle.getAttribute("aria-expanded") !== "true";
      setFiltersOpen(open);
    });

    els.detail?.addEventListener("click", (e) => {
      if (e.target.closest("[data-close-detail]")) closeDetail();
    });

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
        history.replaceState(null, "", name === "study" ? "#study" : "#library");
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
  }

  async function loadVocab() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(VOCAB_URL, { cache: "no-cache" });
      if (!res.ok) throw new Error(`Failed to load vocab (${res.status})`);
      const data = await res.json();
      App.cards = Array.isArray(data.cards) ? data.cards : [];
      App.keywords = Array.isArray(data.keywords)
        ? data.keywords
        : [...new Set(App.cards.flatMap((c) => c.keywords || []))].sort();
      App.posList = Array.isArray(data.posList)
        ? data.posList
        : [...new Set(App.cards.map((c) => c.pos).filter(Boolean))].sort();
      App.counts = data.counts || {
        total: App.cards.length,
        learning: App.cards.filter((c) => c.status === "learning").length,
        known: App.cards.filter((c) => c.status === "known").length,
      };

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
  App.openDetail = openDetail;
  App.showTab = showTab;
  App.applyFilters = applyFilters;

  wireEvents();
  showTab("library");
  loadVocab();
})();
