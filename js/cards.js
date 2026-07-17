/**
 * Flashcard study UI. Depends on window.SRS and App.cards.
 *
 * Expected DOM IDs (created if missing under #view-study when possible):
 *   #view-study, #study-filters, #study-start, #study-session,
 *   #flashcard, #flashcard-front, #flashcard-back, #study-actions,
 *   #btn-again, #btn-hard, #btn-good, #btn-easy, #study-progress,
 *   #study-empty, #btn-reveal
 *
 * App.cards items: { id, hanzi, pinyin, pos, gloss, example, exampleEn, keywords, status }
 */
(function (global) {
  'use strict';

  var session = {
    active: false,
    queue: [],
    index: 0,
    flipped: false,
    filter: {},
    totalDueAtStart: 0,
  };

  var els = {};
  var bound = false;

  function $(id) {
    return document.getElementById(id);
  }

  function ensureEl(id, tag, parent, className) {
    var node = $(id);
    if (node) return node;
    if (!parent) return null;
    node = document.createElement(tag || 'div');
    node.id = id;
    if (className) node.className = className;
    parent.appendChild(node);
    return node;
  }

  function resolveElements() {
    var view = $('view-study') || document.querySelector('[data-view="study"]');
    els.view = view;
    els.idle = $('study-idle');

    els.filters = $('study-filters') || ensureEl('study-filters', 'div', view, 'study-filters');
    els.start = $('study-start') || ensureEl('study-start', 'button', view, 'study-start');
    if (els.start && !els.start.textContent.trim()) els.start.textContent = 'Start study';

    els.session = $('study-session') || ensureEl('study-session', 'div', view, 'study-session');
    els.progress = $('study-progress') || ensureEl('study-progress', 'div', els.session, 'study-progress');
    els.progressFill = $('study-progress-fill');
    els.empty = $('study-empty') || ensureEl('study-empty', 'div', els.idle || view, 'study-empty');
    if (els.empty && !els.empty.textContent.trim()) {
      els.empty.textContent = 'No due cards match this filter.';
    }

    els.flashcard = $('flashcard') || ensureEl('flashcard', 'div', els.session, 'flashcard');
    els.front = $('flashcard-front') || ensureEl('flashcard-front', 'div', els.flashcard, 'flashcard-front');
    els.back = $('flashcard-back') || ensureEl('flashcard-back', 'div', els.flashcard, 'flashcard-back');

    els.actions = $('study-actions') || ensureEl('study-actions', 'div', els.session, 'study-actions');
    els.reveal = $('btn-reveal') || ensureEl('btn-reveal', 'button', els.session, 'btn-reveal');
    if (els.reveal && !els.reveal.textContent.trim()) els.reveal.textContent = 'Reveal answer';

    els.again = $('btn-again') || ensureEl('btn-again', 'button', els.actions, 'btn-again');
    els.hard = $('btn-hard') || ensureEl('btn-hard', 'button', els.actions, 'btn-hard');
    els.good = $('btn-good') || ensureEl('btn-good', 'button', els.actions, 'btn-good');
    els.easy = $('btn-easy') || ensureEl('btn-easy', 'button', els.actions, 'btn-easy');
  }

  function getAppCards() {
    var app = global.App;
    if (!app || !Array.isArray(app.cards)) return [];
    return app.cards;
  }

  function collectKeywords(cards) {
    var set = {};
    var fromApp = global.App && Array.isArray(global.App.keywords) ? global.App.keywords : null;
    if (fromApp) {
      for (var i = 0; i < fromApp.length; i++) set[fromApp[i]] = true;
    }
    for (var c = 0; c < cards.length; c++) {
      var kws = cards[c].keywords;
      if (!kws) continue;
      if (typeof kws === 'string') kws = kws.split(/[,;|/]/).map(function (s) { return s.trim(); });
      if (!Array.isArray(kws)) continue;
      for (var k = 0; k < kws.length; k++) {
        if (kws[k]) set[kws[k]] = true;
      }
    }
    return Object.keys(set).sort();
  }

  function collectStatuses(cards) {
    var set = {};
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].status) set[cards[i].status] = true;
    }
    var known = ['new', 'learning', 'known', 'review'];
    var out = [];
    for (var k = 0; k < known.length; k++) {
      if (set[known[k]]) {
        out.push(known[k]);
        delete set[known[k]];
      }
    }
    Object.keys(set).sort().forEach(function (s) { out.push(s); });
    return out;
  }

  var THEME_KEYWORDS = [
    'food', 'emotion', 'work', 'relationship', 'internet', 'travel',
    'body', 'time', 'daily-life', 'idiom', 'learning', 'known',
  ];

  function studyKeywordOptions(cards) {
    var available = {};
    var all = collectKeywords(cards);
    for (var i = 0; i < all.length; i++) available[all[i]] = true;
    var out = [];
    for (var t = 0; t < THEME_KEYWORDS.length; t++) {
      if (available[THEME_KEYWORDS[t]]) out.push(THEME_KEYWORDS[t]);
    }
    return out;
  }

  function populateFilters() {
    if (!els.filters) return;
    var cards = getAppCards();
    var statuses = collectStatuses(cards);
    var keywords = studyKeywordOptions(cards);

    // Prefer existing selects from index.html when present
    var statusSelect = $('study-status') || $('study-filter-status');
    var kwSelect = $('study-keyword') || $('study-filter-keyword');

    if (!statusSelect || !kwSelect) {
      els.filters.innerHTML = '';

      var statusLabel = document.createElement('label');
      statusLabel.className = 'select-field';
      statusLabel.innerHTML = '<span class="field-label">Status</span>';
      statusSelect = document.createElement('select');
      statusSelect.id = 'study-status';
      statusLabel.appendChild(statusSelect);
      els.filters.appendChild(statusLabel);

      var kwLabel = document.createElement('label');
      kwLabel.className = 'select-field';
      kwLabel.innerHTML = '<span class="field-label">Keyword</span>';
      kwSelect = document.createElement('select');
      kwSelect.id = 'study-keyword';
      kwLabel.appendChild(kwSelect);
      els.filters.appendChild(kwLabel);
    }

    var prevStatus = statusSelect.value;
    var prevKw = kwSelect.value;

    statusSelect.innerHTML = '';
    var optAll = document.createElement('option');
    optAll.value = '';
    optAll.textContent = 'All';
    statusSelect.appendChild(optAll);
    for (var s = 0; s < statuses.length; s++) {
      var o = document.createElement('option');
      o.value = statuses[s];
      o.textContent = statuses[s];
      statusSelect.appendChild(o);
    }
    if (prevStatus) statusSelect.value = prevStatus;

    kwSelect.innerHTML = '';
    var kwAll = document.createElement('option');
    kwAll.value = '';
    kwAll.textContent = 'All keywords';
    kwSelect.appendChild(kwAll);
    for (var k = 0; k < keywords.length; k++) {
      var ko = document.createElement('option');
      ko.value = keywords[k];
      ko.textContent = keywords[k];
      kwSelect.appendChild(ko);
    }
    if (prevKw) kwSelect.value = prevKw;

    els.statusSelect = statusSelect;
    els.keywordSelect = kwSelect;
  }

  function cardMatchesFilter(card, filter) {
    if (!card) return false;
    if (filter.status && card.status !== filter.status) return false;
    if (filter.keyword) {
      var kws = card.keywords;
      if (!kws) return false;
      if (typeof kws === 'string') {
        kws = kws.split(/[,;|/]/).map(function (s) { return s.trim(); });
      }
      if (!Array.isArray(kws) || kws.indexOf(filter.keyword) === -1) return false;
    }
    return true;
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function currentCard() {
    if (!session.active || session.index >= session.queue.length) return null;
    return session.queue[session.index];
  }

  function setVisible(node, visible) {
    if (!node) return;
    node.hidden = !visible;
    node.style.display = visible ? '' : 'none';
  }

  function showRatingButtons(show) {
    setVisible(els.actions, show);
    if (els.again) els.again.disabled = !show;
    if (els.hard) els.hard.disabled = !show;
    if (els.good) els.good.disabled = !show;
    if (els.easy) els.easy.disabled = !show;
  }

  function updateProgress() {
    if (!session.active) {
      if (els.progress) els.progress.textContent = '';
      if (els.progressFill) els.progressFill.style.width = '0%';
      return;
    }
    var done = session.index;
    var total = session.queue.length || 1;
    var pos = Math.min(session.index + 1, session.queue.length);
    var pct = Math.round((done / total) * 100);
    if (session.index >= session.queue.length) pct = 100;
    if (els.progressFill) els.progressFill.style.width = pct + '%';
    if (els.progress) {
      els.progress.textContent =
        (session.queue.length ? pos : 0) + ' / ' + session.queue.length +
        ' · ' + Math.max(0, session.queue.length - session.index) + ' left';
    }
  }

  function renderCard() {
    var card = currentCard();
    if (!card) {
      setVisible(els.flashcard, false);
      setVisible(els.reveal, false);
      showRatingButtons(false);
      setVisible(els.empty, true);
      if (els.empty) els.empty.textContent = 'No due cards match this filter.';
      updateProgress();
      return;
    }

    setVisible(els.empty, false);
    setVisible(els.flashcard, true);
    setVisible(els.reveal, !session.flipped);

    if (els.front) {
      els.front.innerHTML =
        '<div class="flashcard-hanzi">' + escapeHtml(card.hanzi || '') + '</div>' +
        (session.flipped
          ? ''
          : '<div class="flashcard-hint">tap to reveal</div>');
      setVisible(els.front, true);
    }

    if (els.back) {
      if (session.flipped) {
        var parts = [];
        if (card.pinyin) parts.push('<div class="flashcard-pinyin">' + escapeHtml(card.pinyin) + '</div>');
        if (card.pos) parts.push('<div class="flashcard-pos">' + escapeHtml(card.pos) + '</div>');
        if (card.gloss) parts.push('<div class="flashcard-gloss">' + escapeHtml(card.gloss) + '</div>');
        if (card.example || card.exampleEn) {
          parts.push(
            '<div class="flashcard-example">' +
              (card.example ? '<div>' + escapeHtml(card.example) + '</div>' : '') +
              (card.exampleEn ? '<div class="flashcard-example-en">' + escapeHtml(card.exampleEn) + '</div>' : '') +
            '</div>'
          );
        }
        els.back.innerHTML = parts.join('');
        setVisible(els.back, true);
      } else {
        els.back.innerHTML = '';
        setVisible(els.back, false);
      }
    }

    if (els.flashcard) {
      els.flashcard.classList.toggle('is-flipped', !!session.flipped);
    }

    showRatingButtons(!!session.flipped);
    updateProgress();
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function readFilterFromDom() {
    var status = els.statusSelect ? els.statusSelect.value : '';
    var keyword = els.keywordSelect ? els.keywordSelect.value : '';
    return {
      status: status || undefined,
      keyword: keyword || undefined,
    };
  }

  function startSession(filter) {
    if (!global.SRS) {
      console.error('Cards: window.SRS is required');
      return;
    }

    filter = filter || readFilterFromDom() || {};
    session.filter = {
      status: filter.status || undefined,
      keyword: filter.keyword || undefined,
    };

    var cards = getAppCards().filter(function (c) {
      return cardMatchesFilter(c, session.filter);
    });
    var ids = cards.map(function (c) { return c.id; });
    var dueIds = global.SRS.dueCards(ids);
    var dueSet = {};
    for (var i = 0; i < dueIds.length; i++) dueSet[dueIds[i]] = true;

    var queue = cards.filter(function (c) { return dueSet[c.id]; });
    queue = shuffle(queue);

    session.active = true;
    session.queue = queue;
    session.index = 0;
    session.flipped = false;
    session.totalDueAtStart = queue.length;

    if (!queue.length) {
      setVisible(els.idle, true);
      setVisible(els.session, false);
      setVisible(els.empty, true);
      if (els.empty) els.empty.textContent = 'No cards due. Check back later or widen filters.';
      return;
    }

    setVisible(els.idle, false);
    setVisible(els.empty, false);
    setVisible(els.session, true);
    renderCard();
  }

  function flip() {
    if (!session.active || !currentCard()) return;
    if (session.flipped) return;
    session.flipped = true;
    renderCard();
  }

  function rate(rating) {
    if (!session.active || !session.flipped) return;
    var card = currentCard();
    if (!card || !global.SRS) return;

    global.SRS.review(card.id, rating);
    session.index += 1;
    session.flipped = false;

    if (session.index >= session.queue.length) {
      if (els.progressFill) els.progressFill.style.width = '100%';
      if (els.progress) {
        els.progress.textContent =
          session.totalDueAtStart + ' / ' + session.totalDueAtStart + ' · done';
      }
      endSession();
      setVisible(els.session, false);
      setVisible(els.idle, true);
      setVisible(els.empty, true);
      if (els.empty) els.empty.textContent = 'Session complete. Start again anytime.';
      return;
    }

    renderCard();
  }

  function endSession() {
    session.active = false;
    session.queue = [];
    session.index = 0;
    session.flipped = false;
    showRatingButtons(false);
    setVisible(els.reveal, false);
    if (els.flashcard) els.flashcard.classList.remove('is-flipped');
  }

  function onKeydown(e) {
    if (!session.active) return;
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      if (!session.flipped) flip();
      return;
    }
    if (!session.flipped) return;
    if (e.key === '1') { e.preventDefault(); rate('again'); }
    else if (e.key === '2') { e.preventDefault(); rate('hard'); }
    else if (e.key === '3') { e.preventDefault(); rate('good'); }
    else if (e.key === '4') { e.preventDefault(); rate('easy'); }
  }

  function wireEvents() {
    if (bound) return;
    bound = true;

    if (els.start) {
      els.start.addEventListener('click', function () {
        startSession(readFilterFromDom());
      });
    }
    if (els.reveal) {
      els.reveal.addEventListener('click', function (e) {
        e.stopPropagation();
        flip();
      });
    }
    if (els.flashcard) {
      els.flashcard.addEventListener('click', function () {
        if (!session.flipped) flip();
      });
    }
    if (els.again) els.again.addEventListener('click', function () { rate('again'); });
    if (els.hard) els.hard.addEventListener('click', function () { rate('hard'); });
    if (els.good) els.good.addEventListener('click', function () { rate('good'); });
    if (els.easy) els.easy.addEventListener('click', function () { rate('easy'); });

    document.addEventListener('keydown', onKeydown);
  }

  function init() {
    resolveElements();
    populateFilters();
    wireEvents();
    showRatingButtons(false);
    setVisible(els.empty, false);
    setVisible(els.idle, true);
    setVisible(els.session, false);
  }

  global.Cards = {
    init: init,
    startSession: startSession,
    flip: flip,
    rate: rate,
    endSession: endSession,
  };
})(typeof window !== 'undefined' ? window : globalThis);
