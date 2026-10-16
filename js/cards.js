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
    starting: false,
    locked: false,
    queue: [],
    index: 0,
    flipped: false,
    filter: {},
    totalDueAtStart: 0,
    revealAfter: 0,
  };

  var els = {};
  var bound = false;
  var blockStartClicksUntil = 0;

  var TONE_MARKS = {
    a: "\u0101\u00e1\u01ce\u00e0",
    e: "\u0113\u00e9\u011b\u00e8",
    i: "\u012b\u00ed\u01d0\u00ec",
    o: "\u014d\u00f3\u01d2\u00f2",
    u: "\u016b\u00fa\u01d4\u00f9",
    "\u00fc": "\u01d6\u01d8\u01da\u01dc",
  };

  function syllableTone(raw) {
    var original = String(raw || "").trim();
    if (!original) return "";
    var lower = original.toLowerCase().replace(/u:/g, "\u00fc").replace(/v/g, "\u00fc");
    if (!/^[a-z\u00fc]+[1-5]$/.test(lower)) return original;
    var tone = Number(lower.slice(-1));
    var syl = lower.slice(0, -1);
    if (!syl) return original;
    var upper = original[0] !== original[0].toLowerCase();
    if (tone === 5) {
      syl = spellUmlaut(syl);
      return upper ? syl.charAt(0).toUpperCase() + syl.slice(1) : syl;
    }
    var idx = -1;
    if (syl.indexOf("a") >= 0) idx = syl.indexOf("a");
    else if (syl.indexOf("e") >= 0) idx = syl.indexOf("e");
    else if (syl.indexOf("ou") >= 0) idx = syl.indexOf("o");
    else {
      for (var i = syl.length - 1; i >= 0; i--) {
        if ("aeiou\u00fc".indexOf(syl.charAt(i)) >= 0) {
          idx = i;
          break;
        }
      }
    }
    var vowel = idx >= 0 ? syl.charAt(idx) : "";
    var marks = TONE_MARKS[vowel];
    if (!marks || tone < 1 || tone > 4) {
      syl = spellUmlaut(syl);
      return upper ? syl.charAt(0).toUpperCase() + syl.slice(1) : syl;
    }
    var marked = syl.slice(0, idx) + marks.charAt(tone - 1) + syl.slice(idx + 1);
    marked = spellUmlaut(marked);
    return upper ? marked.charAt(0).toUpperCase() + marked.slice(1) : marked;
  }

  function spellUmlaut(syl) {
    if (syl.indexOf("\u00fc") < 0 && syl.indexOf("\u01d6") < 0 && syl.indexOf("\u01d8") < 0 && syl.indexOf("\u01da") < 0 && syl.indexOf("\u01dc") < 0) {
      return syl;
    }
    var head = syl.charAt(0);
    if (head === "j" || head === "q" || head === "x" || head === "y" || head === "J" || head === "Q" || head === "X" || head === "Y") {
      return syl
        .replace(/\u00fc/g, "u")
        .replace(/\u01d6/g, "\u016b")
        .replace(/\u01d8/g, "\u00fa")
        .replace(/\u01da/g, "\u01d4")
        .replace(/\u01dc/g, "\u00f9");
    }
    return syl;
  }

  function formatPinyin(value) {
    return String(value == null ? "" : value)
      .split(/(\s+)/)
      .map(function (part) {
        return /\s/.test(part) ? part : syllableTone(part);
      })
      .join("");
  }

  function foldPinyin(value) {
    var text = formatPinyin(value).replace(/u:/gi, "\u00fc").replace(/v/gi, "\u00fc");
    return text
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\u00fc/g, "u");
  }

  function queryTokens(value) {
    return foldPinyin(value).split(/[^a-z0-9]+/).filter(Boolean);
  }

  // Free-text search. "learning"/"known" are status, not vocabulary, so a
  // query like nǐ must not match every card still being learned.
  function matchesQuery(query, card) {
    var q = foldPinyin(query).trim();
    if (!q) return true;
    card = card || {};
    var hanzi = String(card.hanzi || "");
    var raw = String(query || "").trim().toLowerCase();
    if (raw && hanzi.toLowerCase().indexOf(raw) >= 0) return true;

    var pinyin = foldPinyin(card.pinyin);
    var gloss = foldPinyin(card.gloss);
    if (q.indexOf(" ") >= 0) {
      return pinyin.indexOf(q) >= 0 || gloss.indexOf(q) >= 0;
    }

    var syllables = queryTokens(card.pinyin);
    for (var i = 0; i < syllables.length; i++) {
      if (syllables[i].indexOf(q) === 0) return true;
    }

    var parts = [card.gloss, card.pos];
    var kws = Array.isArray(card.keywords) ? card.keywords : [];
    for (var k = 0; k < kws.length; k++) {
      if (kws[k] !== "learning" && kws[k] !== "known") parts.push(kws[k]);
    }
    var letters = /^[a-z0-9]+$/.test(q);
    for (var p = 0; p < parts.length; p++) {
      var bits = queryTokens(parts[p]);
      for (var b = 0; b < bits.length; b++) {
        if (letters) {
          if (bits[b].indexOf(q) === 0) return true;
        } else if (bits[b].indexOf(q) >= 0) {
          return true;
        }
      }
    }
    return false;
  }

  global.Pinyin = {
    format: formatPinyin,
    fold: foldPinyin,
    matches: matchesQuery,
  };

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
      els.empty.textContent = 'No due cards in this topic. Widen the filter — the desk will fill again.';
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

    els.exitFocus = $('practice-focus-exit');
    if (!els.exitFocus && els.session) {
      els.exitFocus = document.createElement('button');
      els.exitFocus.type = 'button';
      els.exitFocus.id = 'practice-focus-exit';
      els.exitFocus.className = 'practice-focus-exit';
      els.exitFocus.setAttribute('aria-label', 'Exit');
      els.exitFocus.textContent = '\u00d7';
      els.session.insertBefore(els.exitFocus, els.session.firstChild);
    }
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
    'common-3500',
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

  function dailyReviewed() {
    if (!global.Daily || typeof global.Daily.reviewedToday !== 'function') return 0;
    return global.Daily.reviewedToday();
  }

  function updateProgress() {
    var reviewed = dailyReviewed();
    var goal = global.Daily && global.Daily.GOAL ? global.Daily.GOAL : 20;
    var shown = reviewed > goal ? goal : reviewed;
    var pct = Math.round((shown / goal) * 100);
    if (!session.active) {
      if (els.progress) els.progress.textContent = '';
      if (els.progressFill) els.progressFill.style.width = '0%';
      return;
    }
    if (els.progressFill) els.progressFill.style.width = pct + '%';
    if (els.progress) els.progress.textContent = shown + '/' + goal;
    if (global.Daily && typeof global.Daily.paint === 'function') global.Daily.paint();
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
          escapeHtml([formatPinyin(entry.pinyin || ''), entry.meaning].filter(Boolean).join(' · ')) +
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
        meta = [formatPinyin(entry.pinyin || ''), entry.meaning].filter(Boolean).join(' · ');
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
      if (els.empty) els.empty.textContent = 'No due cards in this topic. Widen the filter — the desk will fill again.';
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
        if (card.pinyin) parts.push('<div class="flashcard-pinyin">' + escapeHtml(formatPinyin(card.pinyin)) + '</div>');
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
              ? [formatPinyin(entry.pinyin || ''), entry.meaning].filter(Boolean).join(' · ')
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
    try {
      var pending = global.VocabAudio && global.VocabAudio.play(card);
      if (pending && typeof pending.catch === "function") pending.catch(function () {});
    } catch (e) {
      /* playback is optional */
    }
  }

  function advanceQueue() {
    session.locked = false;
    session.revealAfter = Date.now() + 280;
    session.index += 1;
    session.flipped = false;
    if (session.index >= session.queue.length) {
      endSession();
      setVisible(els.session, false);
      setVisible(els.idle, true);
      if (global.Daily && typeof global.Daily.paint === 'function') global.Daily.paint();
      if (session.celebrate && global.Daily && typeof global.Daily.showCelebration === 'function') {
        global.Daily.showCelebration();
      }
      session.celebrate = false;
      var snap = global.Daily && typeof global.Daily.snapshot === 'function'
        ? global.Daily.snapshot(getAppCards())
        : null;
      if (!snap || !snap.done) {
        setVisible(els.empty, true);
        if (els.empty) els.empty.textContent = 'Session complete. Start again whenever you are ready.';
      }
      return;
    }
    renderCard();
  }

  function wireMarkKnown(root, card) {
    if (!root || !card) return;
    var btn = root.querySelector('[data-mark-known]');
    if (!btn) return;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (session.locked || !session.flipped) return;
      session.locked = true;
      if (global.App && typeof global.App.setCardStatus === 'function') {
        global.App.setCardStatus(card.id, 'known');
      } else if (global.StatusStore) {
        global.StatusStore.setCardStatus(card, 'known');
      }
      advanceQueue();
    });
  }

  function readFilterFromDom() {
    var keyword = els.keywordSelect ? els.keywordSelect.value : '';
    return {
      keyword: keyword || undefined,
    };
  }

  function startSession(filter) {
    if (session.active || session.starting) return;
    if (!global.SRS) {
      console.error('Cards: window.SRS is required');
      return;
    }
    session.starting = true;

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
    var snap = global.Daily && typeof global.Daily.snapshot === 'function'
      ? global.Daily.snapshot(getAppCards())
      : null;
    if (snap) queue = queue.slice(0, snap.remaining);

    session.celebrate = false;
    session.revealAfter = 0;
    session.queue = queue;
    session.index = 0;
    session.flipped = false;
    session.totalDueAtStart = queue.length;
    ensureCharactersLoaded();

    if (!queue.length) {
      session.active = false;
      session.starting = false;
      session.locked = false;
      setVisible(els.idle, true);
      setVisible(els.session, false);
      if (snap && snap.done && global.Daily && typeof global.Daily.paint === 'function') {
        global.Daily.paint();
        setVisible(els.empty, false);
        return;
      }
      setVisible(els.empty, true);
      if (els.empty) {
        els.empty.textContent = session.filter.keyword
          ? 'Your desk is clear — no cards due in this topic. Widen the filter, or return tomorrow.'
          : 'Your desk is clear — no cards due. Widen filters, or return tomorrow.';
      }
      return;
    }

    session.active = true;
    session.starting = false;
    session.locked = false;

    setVisible(els.idle, false);
    setVisible(els.empty, false);
    setVisible(els.session, true);
    renderCard();
    playCardAudio(currentCard());
    enterPracticeFocus();
  }

  function flip() {
    if (!session.active || !currentCard()) return;
    if (session.flipped) return;
    if (Date.now() < session.revealAfter) return;
    session.flipped = true;
    renderCard();
    playCardAudio(currentCard());
  }

  function rate(rating) {
    if (!session.active || !session.flipped || session.locked) return;
    var card = currentCard();
    if (!card || !global.SRS) return;
    session.locked = true;

    var reviewed;
    try {
      reviewed = global.SRS.review(card.id, rating);
    } catch (err) {
      session.locked = false;
      return;
    }
    try {
      if (global.JourneyStore && typeof global.JourneyStore.logStudy === "function") {
        global.JourneyStore.logStudy(1);
      }
      if (global.Daily && typeof global.Daily.recordReview === "function") {
        var result = global.Daily.recordReview(rating, reviewed && reviewed.last);
        if (result && result.justHit) session.celebrate = true;
      }
    } catch (err) {
      /* still move on so a storage failure cannot grade the same card twice */
    }
    advanceQueue();
  }

  function endSession() {
    session.active = false;
    session.starting = false;
    session.locked = false;
    session.queue = [];
    session.index = 0;
    session.flipped = false;
    blockStartClicksUntil = Date.now() + 400;
    showRatingButtons(false);
    setVisible(els.reveal, false);
    if (els.flashcard) els.flashcard.classList.remove('is-flipped');
    exitPracticeFocus();
  }

  var practiceFocus = false;
  var browserFullscreen = false;

  function fullscreenNode() {
    if (typeof document === 'undefined') return null;
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function requestPracticeFullscreen() {
    try {
      if (typeof document === 'undefined' || !document.documentElement) return;
      if (typeof document.documentElement.requestFullscreen !== 'function') return;
      if (fullscreenNode()) return;
      var pending = document.documentElement.requestFullscreen();
      if (pending && typeof pending.catch === 'function') pending.catch(function () {});
    } catch (err) {
      /* iOS and other browsers without the Fullscreen API */
    }
  }

  function exitPracticeFullscreen() {
    try {
      if (!fullscreenNode()) return;
      if (typeof document.exitFullscreen !== 'function') return;
      var pending = document.exitFullscreen();
      if (pending && typeof pending.catch === 'function') pending.catch(function () {});
    } catch (err) {
      /* already left fullscreen */
    }
  }

  function overlayOpen() {
    var detail = document.getElementById('card-detail');
    var origin = document.getElementById('char-origin-overlay');
    if (detail && !detail.hidden) return true;
    if (origin && !origin.hidden) return true;
    return false;
  }

  function focusCardIfStudying() {
    if (!session.active || !els.flashcard) return;
    var view = document.getElementById('view-study');
    if (!view || view.hidden) return;
    try {
      els.flashcard.focus({ preventScroll: true });
    } catch (err) {
      try { els.flashcard.focus(); } catch (e) { /* focus is optional */ }
    }
  }

  function resetPracticeScroll() {
    if (typeof document === 'undefined') return;
    var nodes = [
      document.scrollingElement,
      document.documentElement,
      document.body,
      document.getElementById('view-study'),
      document.getElementById('view-root'),
      document.querySelector('.main'),
      document.querySelector('.app'),
    ];
    for (var i = 0; i < nodes.length; i++) {
      if (!nodes[i]) continue;
      nodes[i].scrollTop = 0;
      nodes[i].scrollLeft = 0;
    }
    try { window.scrollTo(0, 0); } catch (err) { /* ignore */ }
  }

  function placeExitButton() {
    var btn = document.getElementById('practice-focus-exit');
    if (!btn || !document.body || btn.parentElement === document.body) return;
    document.body.appendChild(btn);
  }

  function enterPracticeFocus() {
    if (typeof document === 'undefined' || !document.documentElement) return;
    var already = practiceFocus;
    practiceFocus = true;
    document.documentElement.classList.add('practice-focus');
    placeExitButton();
    resetPracticeScroll();
    if (!already) requestPracticeFullscreen();
    // Fullscreen and scroll anchoring can move the view after this turn.
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(function () {
        if (!practiceFocus) return;
        resetPracticeScroll();
        requestAnimationFrame(function () {
          if (practiceFocus) resetPracticeScroll();
        });
      });
    }
  }

  function exitPracticeFocus() {
    if (typeof document === 'undefined' || !document.documentElement) return;
    var was = practiceFocus || document.documentElement.classList.contains('practice-focus');
    practiceFocus = false;
    browserFullscreen = false;
    document.documentElement.classList.remove('practice-focus');
    if (!was) return;
    exitPracticeFullscreen();
    focusCardIfStudying();
  }

  function onFullscreenChange() {
    var active = fullscreenNode();
    if (active) {
      browserFullscreen = true;
      if (practiceFocus) resetPracticeScroll();
      return;
    }
    // A rejected requestFullscreen (iOS) must not drop the focus layout.
    if (!browserFullscreen || !practiceFocus) return;
    browserFullscreen = false;
    practiceFocus = false;
    if (document.documentElement) document.documentElement.classList.remove('practice-focus');
    focusCardIfStudying();
  }

  function onFocusKey(e) {
    if (!e || e.key !== 'Escape') return;
    if (!practiceFocus) return;
    if (overlayOpen()) return;
    exitPracticeFocus();
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
        if (Date.now() < blockStartClicksUntil) return;
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
    if (els.exitFocus) {
      els.exitFocus.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        exitPracticeFocus();
      });
    }

    document.addEventListener('keydown', onKeydown);
    document.addEventListener('keydown', onFocusKey, true);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
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
    enterPracticeFocus: enterPracticeFocus,
    exitPracticeFocus: exitPracticeFocus,
  };
  global.Cards.session = session;
  global.Cards.renderCard = renderCard;
})(typeof window !== 'undefined' ? window : globalThis);
