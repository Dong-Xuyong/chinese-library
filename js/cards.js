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
    if (els.flashcard) {
      els.flashcard.setAttribute('role', 'button');
      els.flashcard.setAttribute('tabindex', '0');
      if (!els.flashcard.getAttribute('aria-label')) {
        els.flashcard.setAttribute('aria-label', 'Flashcard — tap to flip');
      }
    }
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

  var THEME_KEYWORDS = [
    'food', 'emotion', 'work', 'relationship', 'internet', 'travel',
    'body', 'time', 'daily-life', 'idiom',
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
    var keywords = studyKeywordOptions(cards);

    var kwSelect = $('study-keyword') || $('study-filter-keyword');

    if (!kwSelect) {
      els.filters.innerHTML = '';
      var kwLabel = document.createElement('label');
      kwLabel.className = 'select-field';
      kwLabel.innerHTML = '<span class="field-label">Topic</span>';
      kwSelect = document.createElement('select');
      kwSelect.id = 'study-keyword';
      kwLabel.appendChild(kwSelect);
      els.filters.appendChild(kwLabel);
    }

    var prevKw = kwSelect.value;

    kwSelect.innerHTML = '';
    var kwAll = document.createElement('option');
    kwAll.value = '';
    kwAll.textContent = 'All topics';
    kwSelect.appendChild(kwAll);
    for (var k = 0; k < keywords.length; k++) {
      var ko = document.createElement('option');
      ko.value = keywords[k];
      ko.textContent = keywords[k];
      kwSelect.appendChild(ko);
    }
    if (prevKw) kwSelect.value = prevKw;

    els.keywordSelect = kwSelect;
  }

  function cardMatchesFilter(card, filter) {
    if (!card) return false;
    // Known words stay in the library/progress views, not in study sessions.
    if (card.status === 'known') return false;
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


  function isCjkChar(ch) {
    if (!ch) return false;
    var code = ch.codePointAt(0);
    return (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0xf900 && code <= 0xfaff)
    );
  }

  function cjkCharsFromHanzi(hanzi) {
    var out = [];
    var chars = Array.from(String(hanzi || ''));
    for (var i = 0; i < chars.length; i++) {
      if (isCjkChar(chars[i])) out.push(chars[i]);
    }
    return out;
  }

  function getCharacterEntry(ch) {
    if (global.App && typeof global.App.getCharacter === 'function') {
      return global.App.getCharacter(ch);
    }
    if (global.App && global.App.characters) return global.App.characters[ch] || null;
    return null;
  }

  function ensureCharactersLoaded(thenFn) {
    if (global.App && typeof global.App.ensureCharacters === 'function') {
      global.App.ensureCharacters().then(function () {
        if (typeof thenFn === 'function') thenFn();
      });
      return;
    }
    if (typeof thenFn === 'function') thenFn();
  }

  function flashcardCharPanelHtml(ch) {
    var entry = getCharacterEntry(ch);
    if (!entry) {
      return (
        '<p class="flashcard-origin-empty">Origin not available yet for ' +
        escapeHtml(ch) +
        '.</p>'
      );
    }
    var comp = entry.composition || {};
    var parts = [];
    if (entry.pinyin || entry.meaning) {
      parts.push(
        '<p class="flashcard-origin-meta">' +
          escapeHtml([entry.pinyin, entry.meaning].filter(Boolean).join(' · ')) +
          '</p>'
      );
    }
    if (comp.type) {
      parts.push('<p class="flashcard-origin-type">' + escapeHtml(comp.type) + '</p>');
    }
    if (comp.formula) {
      parts.push('<p class="flashcard-origin-formula">' + escapeHtml(comp.formula) + '</p>');
    }
    if (entry.origin) {
      parts.push(
        '<div class="flashcard-origin-block"><h4>Origin</h4><p>' +
          escapeHtml(entry.origin) +
          '</p></div>'
      );
    }
    if (entry.history) {
      parts.push(
        '<div class="flashcard-origin-block"><h4>History</h4><p>' +
          escapeHtml(entry.history) +
          '</p></div>'
      );
    }
    return parts.join('') || (
      '<p class="flashcard-origin-empty">Origin not available yet for ' +
      escapeHtml(ch) +
      '.</p>'
    );
  }

  function flashcardOriginsHtml(card) {
    var chars = cjkCharsFromHanzi(card && card.hanzi);
    if (!chars.length) return '';
    var rows = [];
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      var entry = getCharacterEntry(ch);
      var meta = '';
      if (entry) {
        meta = [entry.pinyin, entry.meaning].filter(Boolean).join(' · ');
      }
      rows.push(
        '<div class="flashcard-char-item">' +
          '<button type="button" class="flashcard-char-row" data-origin-toggle data-char="' +
          escapeHtml(ch) +
          '" aria-haspopup="dialog">' +
          '<span class="flashcard-char-glyph">' +
          escapeHtml(ch) +
          '</span>' +
          '<span class="flashcard-char-meta">' +
          escapeHtml(meta || 'Origin & history') +
          '</span>' +
          '<span class="flashcard-char-caret" aria-hidden="true">⤢</span>' +
          '</button>' +
        '</div>'
      );
    }
    return (
      '<div class="flashcard-origins">' +
      '<div class="flashcard-origins-label">Characters</div>' +
      rows.join('') +
      '</div>'
    );
  }

  function wireOriginToggles(root) {
    if (!root) return;
    root.querySelectorAll('[data-origin-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var ch = btn.getAttribute('data-char') || '';
        ensureCharactersLoaded(function () {
          if (global.App && typeof global.App.openCharacterOrigin === 'function') {
            global.App.openCharacterOrigin(ch);
          }
        });
      });
    });
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
        audioButtonHtml(card) +
        (session.flipped
          ? ''
          : '<div class="flashcard-hint">tap to reveal</div>');
      setVisible(els.front, true);
      wireAudioButton(els.front, card);
    }

    if (els.back) {
      if (session.flipped) {
        var parts = [];
        if (card.pinyin) parts.push('<div class="flashcard-pinyin">' + escapeHtml(card.pinyin) + '</div>');
        if (card.pos) parts.push('<div class="flashcard-pos">' + escapeHtml(card.pos) + '</div>');
        if (card.gloss) parts.push('<div class="flashcard-gloss">' + escapeHtml(card.gloss) + '</div>');
        parts.push(audioButtonHtml(card));
        if (card.status !== 'known') {
          parts.push(
            '<button type="button" class="btn btn-primary btn-mark-known" data-mark-known>Mark as known</button>'
          );
        }
        parts.push(flashcardOriginsHtml(card));
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
        wireAudioButton(els.back, card);
        wireMarkKnown(els.back, card);
        wireOriginToggles(els.back);
        ensureCharactersLoaded(function () {
          if (!session.flipped || currentCard() !== card) return;
          var panelRoot = els.back;
          if (!panelRoot) return;
          panelRoot.querySelectorAll('.flashcard-char-item').forEach(function (item) {
            var btn = item.querySelector('[data-origin-toggle]');
            if (!btn) return;
            var ch = btn.getAttribute('data-char') || '';
            var entry = getCharacterEntry(ch);
            var meta = entry
              ? [entry.pinyin, entry.meaning].filter(Boolean).join(' · ')
              : 'Origin & history';
            var metaEl = btn.querySelector('.flashcard-char-meta');
            if (metaEl) metaEl.textContent = meta;
          });
        });
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

  function audioButtonHtml(card) {
    var label = card && card.audio ? 'Play audio' : 'Play pronunciation';
    return (
      '<button type="button" class="btn-audio btn-audio-card" data-audio-btn aria-label="' +
      label +
      '" title="' +
      label +
      '">' +
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 010 7"/><path d="M18 6a8 8 0 010 12"/></svg>' +
      '<span>Listen</span></button>'
    );
  }

  function wireAudioButton(root, card) {
    if (!root) return;
    var btn = root.querySelector('[data-audio-btn]');
    if (!btn) return;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      playCardAudio(card);
    });
  }

  function playCardAudio(card) {
    if (global.VocabAudio) global.VocabAudio.play(card);
  }

  function wireMarkKnown(root, card) {
    if (!root || !card) return;
    var btn = root.querySelector('[data-mark-known]');
    if (!btn) return;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (global.App && typeof global.App.setCardStatus === 'function') {
        global.App.setCardStatus(card.id, 'known');
      } else if (global.StatusStore) {
        global.StatusStore.setCardStatus(card, 'known');
      }
      btn.textContent = 'Marked known';
      btn.disabled = true;
    });
  }

  function readFilterFromDom() {
    var keyword = els.keywordSelect ? els.keywordSelect.value : '';
    return {
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
    ensureCharactersLoaded();

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
    playCardAudio(currentCard());
  }

  function flip() {
    if (!session.active || !currentCard()) return;
    if (session.flipped) return;
    session.flipped = true;
    renderCard();
    playCardAudio(currentCard());
  }

  function rate(rating) {
    if (!session.active || !session.flipped) return;
    var card = currentCard();
    if (!card || !global.SRS) return;

    global.SRS.review(card.id, rating);
    if (global.JourneyStore && typeof global.JourneyStore.logStudy === "function") {
      global.JourneyStore.logStudy(1);
    }
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
      els.flashcard.addEventListener('click', function (e) {
        if (e.target.closest('[data-audio-btn]')) return;
        if (e.target.closest('[data-origin-toggle], .flashcard-char-panel, .flashcard-origins')) return;
        if (!session.flipped) flip();
      });
      els.flashcard.addEventListener('keydown', function (e) {
        if (e.target.closest('[data-audio-btn]')) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (!session.flipped) flip();
        }
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
