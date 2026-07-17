/**
 * Per-device status overrides (learning ↔ known) in localStorage.
 */
(function (global) {
  "use strict";

  var STORAGE_KEY = "ml-chinese-status-v1";

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function save(map) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map || {}));
  }

  function getOverride(id) {
    var map = load();
    return map[id] || null;
  }

  function setStatus(id, status) {
    if (!id || (status !== "known" && status !== "learning")) return null;
    var map = load();
    map[id] = status;
    save(map);
    return status;
  }

  function clearStatus(id) {
    var map = load();
    if (map[id]) {
      delete map[id];
      save(map);
    }
  }

  function syncKeywords(card) {
    var kws = Array.isArray(card.keywords) ? card.keywords.slice() : [];
    kws = kws.filter(function (k) {
      return k !== "learning" && k !== "known";
    });
    if (card.status) kws.push(card.status);
    kws.sort();
    card.keywords = kws;
  }

  /** Apply overrides onto card objects (mutates). Keeps baseStatus for reset. */
  function applyToCards(cards) {
    var map = load();
    if (!Array.isArray(cards)) return cards;
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (!card.baseStatus) card.baseStatus = card.status || "learning";
      if (map[card.id] === "known" || map[card.id] === "learning") {
        card.status = map[card.id];
      } else {
        card.status = card.baseStatus;
      }
      syncKeywords(card);
    }
    return cards;
  }

  function setCardStatus(card, status) {
    if (!card || !card.id) return null;
    if (!card.baseStatus) card.baseStatus = card.status || "learning";
    setStatus(card.id, status);
    card.status = status;
    syncKeywords(card);
    return card;
  }

  function counts(cards) {
    var learning = 0;
    var known = 0;
    var list = Array.isArray(cards) ? cards : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].status === "known") known += 1;
      else learning += 1;
    }
    return { total: list.length, learning: learning, known: known };
  }

  global.StatusStore = {
    STORAGE_KEY: STORAGE_KEY,
    load: load,
    getOverride: getOverride,
    setStatus: setStatus,
    clearStatus: clearStatus,
    applyToCards: applyToCards,
    setCardStatus: setCardStatus,
    counts: counts,
  };
})(typeof window !== "undefined" ? window : globalThis);
