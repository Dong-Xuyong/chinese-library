/**
 * Simplified SM-2 spaced-repetition scheduler with localStorage persistence.
 *
 * Card state: { ease, interval, repetitions, due, lapses }
 * Ratings: 'again' | 'hard' | 'good' | 'easy'
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'ml-chinese-srs-v1';
  var DEFAULT_EASE = 2.5;
  var MIN_EASE = 1.3;
  var MINUTE_MS = 60 * 1000;
  var DAY_MS = 24 * 60 * 60 * 1000;

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function save(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state || {}));
  }

  function defaultState(now) {
    return {
      ease: DEFAULT_EASE,
      interval: 0,
      repetitions: 0,
      due: now || Date.now(),
      lapses: 0,
    };
  }

  function getCardState(id) {
    var state = load();
    return state[id] || null;
  }

  function cloneCard(card) {
    return {
      ease: card.ease,
      interval: card.interval,
      repetitions: card.repetitions,
      due: card.due,
      lapses: card.lapses,
    };
  }

  /**
   * @param {string} id
   * @param {'again'|'hard'|'good'|'easy'} rating
   * @returns {{ease:number, interval:number, repetitions:number, due:number, lapses:number}}
   */
  function review(id, rating) {
    var now = Date.now();
    var state = load();
    var card = state[id] ? cloneCard(state[id]) : defaultState(now);

    var ease = typeof card.ease === 'number' ? card.ease : DEFAULT_EASE;
    var interval = typeof card.interval === 'number' ? card.interval : 0;
    var repetitions = typeof card.repetitions === 'number' ? card.repetitions : 0;
    var lapses = typeof card.lapses === 'number' ? card.lapses : 0;

    switch (rating) {
      case 'again':
        repetitions = 0;
        interval = 0;
        ease = Math.max(MIN_EASE, ease - 0.2);
        lapses += 1;
        card.due = now + MINUTE_MS;
        break;

      case 'hard':
        interval = Math.max(1, interval * 1.2);
        ease = Math.max(MIN_EASE, ease - 0.15);
        repetitions += 1;
        card.due = now + interval * DAY_MS;
        break;

      case 'good':
        if (repetitions === 0) interval = 1;
        else if (repetitions === 1) interval = 3;
        else interval = Math.round(interval * ease);
        repetitions += 1;
        card.due = now + interval * DAY_MS;
        break;

      case 'easy':
        if (repetitions === 0) interval = 3;
        else interval = Math.round(interval * ease * 1.3);
        ease += 0.15;
        repetitions += 1;
        card.due = now + interval * DAY_MS;
        break;

      default:
        throw new Error('Unknown rating: ' + rating);
    }

    card.ease = ease;
    card.interval = interval;
    card.repetitions = repetitions;
    card.lapses = lapses;

    state[id] = card;
    save(state);
    return cloneCard(card);
  }

  function isDue(id, now) {
    if (now == null) now = Date.now();
    var card = getCardState(id);
    if (!card) return true; // new cards are due
    return typeof card.due === 'number' ? card.due <= now : true;
  }

  function dueCards(cardIds, now) {
    if (now == null) now = Date.now();
    var ids = cardIds || [];
    return ids.filter(function (id) {
      return isDue(id, now);
    });
  }

  /**
   * @param {string[]} cardIds
   * @returns {{due:number, new:number, learning:number, review:number}}
   */
  function stats(cardIds) {
    var now = Date.now();
    var ids = cardIds || [];
    var result = { due: 0, new: 0, learning: 0, review: 0 };

    for (var i = 0; i < ids.length; i++) {
      var card = getCardState(ids[i]);
      if (!card) {
        result.new += 1;
        result.due += 1;
        continue;
      }

      var due = typeof card.due === 'number' && card.due <= now;
      if (due) result.due += 1;

      if (card.repetitions === 0 || card.interval === 0) {
        result.learning += 1;
      } else {
        result.review += 1;
      }
    }

    return result;
  }

  global.SRS = {
    STORAGE_KEY: STORAGE_KEY,
    load: load,
    save: save,
    getCardState: getCardState,
    review: review,
    isDue: isDue,
    dueCards: dueCards,
    stats: stats,
  };
})(typeof window !== 'undefined' ? window : globalThis);
