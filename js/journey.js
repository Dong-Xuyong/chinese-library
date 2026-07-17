/**
 * Browser-local learning journey: snapshots, events, firstKnown.
 * Storage key: ml-chinese-journey-v1
 */
(function (global) {
  "use strict";

  var STORAGE_KEY = "ml-chinese-journey-v1";
  var MAX_EVENTS = 200;
  var MAX_SNAPSHOTS = 400;

  function todayISO() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function emptyState() {
    return { snapshots: [], events: [], firstKnown: {} };
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyState();
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return emptyState();
      return {
        snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
        events: Array.isArray(parsed.events) ? parsed.events : [],
        firstKnown:
          parsed.firstKnown && typeof parsed.firstKnown === "object"
            ? parsed.firstKnown
            : {},
      };
    } catch (e) {
      return emptyState();
    }
  }

  function save(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state || emptyState()));
  }

  function countsFromCards(cards) {
    var list = Array.isArray(cards) ? cards : [];
    var known = 0;
    var learning = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i].status === "known") known += 1;
      else learning += 1;
    }
    return { learning: learning, known: known, total: list.length };
  }

  function recordSnapshot(cards, date) {
    var state = load();
    var day = date || todayISO();
    var counts = countsFromCards(cards);
    var point = {
      date: day,
      learning: counts.learning,
      known: counts.known,
      total: counts.total,
    };
    var found = -1;
    for (var i = 0; i < state.snapshots.length; i++) {
      if (state.snapshots[i].date === day) {
        found = i;
        break;
      }
    }
    if (found >= 0) state.snapshots[found] = point;
    else state.snapshots.push(point);
    state.snapshots.sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });
    if (state.snapshots.length > MAX_SNAPSHOTS) {
      state.snapshots = state.snapshots.slice(-MAX_SNAPSHOTS);
    }
    save(state);
    return point;
  }

  function pushEvent(evt) {
    if (!evt || !evt.type) return null;
    var state = load();
    var entry = {
      date: evt.date || todayISO(),
      type: evt.type,
      id: evt.id || undefined,
      label: evt.label || "",
      count: typeof evt.count === "number" ? evt.count : undefined,
    };
    state.events.push(entry);
    if (state.events.length > MAX_EVENTS) {
      state.events = state.events.slice(-MAX_EVENTS);
    }
    save(state);
    return entry;
  }

  function logStatusChange(card, status) {
    if (!card || !card.id) return;
    var label = card.hanzi || card.id;
    if (status === "known") {
      var state = load();
      if (!state.firstKnown[card.id]) {
        state.firstKnown[card.id] = todayISO();
        save(state);
      }
      pushEvent({ type: "known", id: card.id, label: label });
    } else if (status === "learning") {
      pushEvent({ type: "learning", id: card.id, label: label });
    }
    if (global.App && Array.isArray(global.App.cards)) {
      recordSnapshot(global.App.cards);
    }
  }

  function logStudy(count, label) {
    var n = typeof count === "number" && count > 0 ? count : 1;
    var state = load();
    var day = todayISO();
    var updated = false;
    for (var i = state.events.length - 1; i >= 0; i--) {
      var e = state.events[i];
      if (e.date === day && e.type === "study") {
        e.count = (typeof e.count === "number" ? e.count : 0) + n;
        e.label = "Studied " + e.count + " cards";
        updated = true;
        break;
      }
    }
    if (!updated) {
      state.events.push({
        date: day,
        type: "study",
        label: label || "Studied " + n + " cards",
        count: n,
      });
    }
    if (state.events.length > MAX_EVENTS) {
      state.events = state.events.slice(-MAX_EVENTS);
    }
    save(state);
    if (global.App && Array.isArray(global.App.cards)) {
      recordSnapshot(global.App.cards);
    }
  }

  function mergeSeries(builtSeries) {
    var state = load();
    var built = Array.isArray(builtSeries) ? builtSeries.slice() : [];
    var lastBuilt = built.length ? built[built.length - 1].date : null;
    var byDate = {};
    var i;

    for (i = 0; i < built.length; i++) {
      byDate[built[i].date] = Object.assign({}, built[i], { source: "vault" });
    }

    for (i = 0; i < state.snapshots.length; i++) {
      var snap = state.snapshots[i];
      if (!snap || !snap.date) continue;
      // Local wins on/after last built date; also append future dates
      if (!lastBuilt || snap.date >= lastBuilt) {
        byDate[snap.date] = Object.assign({}, snap, { source: "local" });
      }
    }

    return Object.keys(byDate)
      .sort()
      .map(function (d) {
        return byDate[d];
      });
  }

  function recentFirstKnown(limit) {
    var state = load();
    var entries = Object.keys(state.firstKnown).map(function (id) {
      return { id: id, date: state.firstKnown[id] };
    });
    entries.sort(function (a, b) {
      if (a.date === b.date) return a.id < b.id ? 1 : -1;
      return a.date < b.date ? 1 : -1;
    });
    var n = typeof limit === "number" ? limit : 8;
    return entries.slice(0, n);
  }

  function recentEvents(limit) {
    var state = load();
    var n = typeof limit === "number" ? limit : 12;
    return state.events.slice(-n).reverse();
  }

  global.JourneyStore = {
    STORAGE_KEY: STORAGE_KEY,
    load: load,
    todayISO: todayISO,
    recordSnapshot: recordSnapshot,
    logStatusChange: logStatusChange,
    logStudy: logStudy,
    mergeSeries: mergeSeries,
    recentFirstKnown: recentFirstKnown,
    recentEvents: recentEvents,
  };
})(typeof window !== "undefined" ? window : globalThis);
