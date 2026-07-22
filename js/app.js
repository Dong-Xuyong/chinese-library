/**
 * More Life Chinese — library shell
 * Loads ./data/vocab.json, filters/renders list + detail, tab + hash routing.
 * Exposes window.App = { cards, filtered, filters, keywords, posList, counts }
 * Study UI is owned by js/cards.js (Cards.init / startSession).
 */
(function () {
  "use strict";

  const VOCAB_URL = "./data/vocab.json";
  const CHARACTERS_URL = "./data/characters.json";

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
    characters: null,
    charactersPromise: null,
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


  function isCjkChar(ch) {
    if (!ch) return false;
    const code = ch.codePointAt(0);
    return (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0xf900 && code <= 0xfaff)
    );
  }

  function getCharacter(ch) {
    if (!ch || !App.characters) return null;
    return App.characters[ch] || null;
  }

    function ensureCharacters() {
    if (App.characters) return Promise.resolve(App.characters);
    if (App.charactersPromise) return App.charactersPromise;
    App.charactersPromise = fetch(CHARACTERS_URL)
      .then((res) => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then((data) => {
        App.characters =
          data && data.characters && typeof data.characters === "object"
            ? data.characters
            : {};
        return App.characters;
      })
      .catch((err) => {
        console.warn("characters.json failed to load:", err);
        App.characters = {};
        return App.characters;
      });
    return App.charactersPromise;
  }

  function hanziGlyphButtons(hanzi, selected) {
    return Array.from(String(hanzi || ""))
      .map((ch) => {
        if (!isCjkChar(ch)) {
          return `<span class="char-glyph-sep">${escapeHtml(ch)}</span>`;
        }
        const active = ch === selected ? " is-active" : "";
        return (
          `<button type="button" class="char-glyph${active}" data-char="${escapeHtml(ch)}" ` +
          `aria-pressed="${ch === selected ? "true" : "false"}" ` +
          `aria-label="Character ${escapeHtml(ch)}">${escapeHtml(ch)}</button>`
        );
      })
      .join("");
  }

  function firstCjkChar(hanzi) {
    for (const ch of Array.from(String(hanzi || ""))) {
      if (isCjkChar(ch)) return ch;
    }
    return "";
  }

  function originPanelHtml(ch) {
    const entry = App.characters && App.characters[ch];
    if (!entry) {
      return (
        `<div class="detail-section detail-origin" id="detail-origin">` +
        `<h3>Character origin</h3>` +
        `<p class="detail-origin-empty">Origin not available yet for ${escapeHtml(ch || "?")}.</p>` +
        `</div>`
      );
    }
    const comp = entry.composition || {};
    const parts = Array.isArray(comp.parts) ? comp.parts : [];
    const partsHtml = parts.length
      ? `<ul class="origin-parts">` +
        parts
          .map((p) => {
            return (
              `<li><span class="origin-part-char">${escapeHtml(p.char || "")}</span>` +
              `<span class="origin-part-role">${escapeHtml(p.role || "")}</span>` +
              (p.note
                ? `<span class="origin-part-note">${escapeHtml(p.note)}</span>`
                : "") +
              `</li>`
            );
          })
          .join("") +
        `</ul>`
      : "";
    const formula = comp.formula
      ? `<p class="origin-formula">${escapeHtml(comp.formula)}</p>`
      : "";
    const type = comp.type
      ? `<span class="origin-type">${escapeHtml(comp.type)}</span>`
      : "";
    return (
      `<div class="detail-section detail-origin" id="detail-origin">` +
      `<h3>Character origin</h3>` +
      `<div class="origin-head">` +
      `<div class="origin-char" aria-hidden="true">${escapeHtml(entry.char || ch)}</div>` +
      `<div class="origin-head-text">` +
      `<p class="origin-pinyin">${escapeHtml(entry.pinyin || "")}</p>` +
      `<p class="origin-meaning">${escapeHtml(entry.meaning || "")}</p>` +
      (type ? `<p class="origin-type-wrap">${type}</p>` : "") +
      `</div></div>` +
      formula +
      partsHtml +
      (entry.origin
        ? `<div class="origin-block"><h4>Origin</h4><p>${escapeHtml(entry.origin)}</p></div>`
        : "") +
      (entry.history
        ? `<div class="origin-block"><h4>History</h4><p>${escapeHtml(entry.history)}</p></div>`
        : "") +
      `</div>`
    );
  }

  function wireOriginSelection() {
    const root = els.detailBody;
    if (!root) return;
    root.querySelectorAll(".char-glyph").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const ch = btn.getAttribute("data-char") || "";
        const panel = document.getElementById("detail-origin");
        if (panel) panel.outerHTML = originPanelHtml(ch);
        root.querySelectorAll(".char-glyph").forEach((b) => {
          const active = b.getAttribute("data-char") === ch;
          b.classList.toggle("is-active", active);
          b.setAttribute("aria-pressed", active ? "true" : "false");
        });
      });
    });
  }


  function openDetail(id) {
    const card = App.cards.find((c) => c.id === id);
    if (!card || !els.detail || !els.detailBody) return;

    const selected = firstCjkChar(card.hanzi);
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
    const glyphHtml = hanziGlyphButtons(card.hanzi, selected);

    const paint = () => {
      els.detailBody.innerHTML = `
      <h2 id="detail-hanzi" class="detail-hanzi detail-hanzi-glyphs" aria-label="${escapeHtml(card.hanzi)}">${glyphHtml}</h2>
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
      ${originPanelHtml(selected)}
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

      wireOriginSelection();
    };

    paint();
    ensureCharacters().then(() => {
      // Refresh origin panel once data arrives (detail may still be open)
      if (!els.detail || els.detail.hidden) return;
      const still = App.cards.find((c) => c.id === id);
      if (!still) return;
      const activeBtn = els.detailBody.querySelector(".char-glyph.is-active");
      const ch = (activeBtn && activeBtn.getAttribute("data-char")) || firstCjkChar(still.hanzi);
      const panel = document.getElementById("detail-origin");
      if (panel) panel.outerHTML = originPanelHtml(ch);
      wireOriginSelection();
    });

    els.detail.hidden = false;
    els.detail.setAttribute("aria-hidden", "false");
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
      ensureCharacters();
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
  App.ensureCharacters = ensureCharacters;
  App.getCharacter = getCharacter;

  wireEvents();
  syncLayoutMode();
  showTab("library");
  loadVocab();
})();
