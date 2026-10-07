/**
 * Cross-device progress sync. On load, remote and local stores are merged.
 * Later edits are saved to GitHub after a short pause.
 */
(function (global) {
  "use strict";

  var APP = "chinese-library";
  var KEYS = {
    status: "ml-chinese-status-v1",
    srs: "ml-chinese-srs-v1",
    journey: "ml-chinese-journey-v1",
  };

  function readAll() {
    var out = {};
    Object.keys(KEYS).forEach(function (k) {
      try {
        out[k] = JSON.parse(localStorage.getItem(KEYS[k]) || "null");
      } catch (e) {
        out[k] = null;
      }
    });
    return out;
  }

  function newerCard(a, b) {
    var sa = [a.last || 0, (a.repetitions || 0) + (a.lapses || 0), a.due || 0];
    var sb = [b.last || 0, (b.repetitions || 0) + (b.lapses || 0), b.due || 0];
    for (var i = 0; i < sa.length; i++) {
      if (sa[i] !== sb[i]) return sb[i] > sa[i] ? b : a;
    }
    return a;
  }

  function mergeSrs(a, b) {
    var out = Object.assign({}, a || {});
    Object.keys(b || {}).forEach(function (id) {
      out[id] = out[id] ? newerCard(out[id], b[id]) : b[id];
    });
    return out;
  }

  function mergeJourney(a, b) {
    a = a || {};
    b = b || {};
    var firstKnown = Object.assign({}, a.firstKnown || {});
    Object.keys(b.firstKnown || {}).forEach(function (id) {
      var d = b.firstKnown[id];
      if (!firstKnown[id] || d < firstKnown[id]) firstKnown[id] = d;
    });

    var snaps = {};
    (a.snapshots || []).concat(b.snapshots || []).forEach(function (s) {
      if (!s || !s.date) return;
      if (!snaps[s.date] || (s.known || 0) > (snaps[s.date].known || 0)) snaps[s.date] = s;
    });

    // "study" is one rolling event per day, so keep the larger count.
    var events = [];
    var byKey = {};
    (a.events || []).concat(b.events || []).forEach(function (e) {
      if (!e || !e.type) return;
      var key = e.type === "study" ? e.date + "|study" : [e.date, e.type, e.id || "", e.label || ""].join("|");
      var prev = byKey[key];
      if (!prev) {
        byKey[key] = e;
        events.push(e);
      } else if (e.type === "study" && (e.count || 0) > (prev.count || 0)) {
        events[events.indexOf(prev)] = e;
        byKey[key] = e;
      }
    });
    events.sort(function (x, y) {
      return x.date < y.date ? -1 : x.date > y.date ? 1 : 0;
    });

    return {
      snapshots: Object.keys(snaps).sort().map(function (d) { return snaps[d]; }).slice(-400),
      events: events.slice(-200),
      firstKnown: firstKnown,
    };
  }

  function merge(local, incoming) {
    return {
      status: Object.assign({}, local.status || {}, incoming.status || {}),
      srs: mergeSrs(local.srs, incoming.srs),
      journey: mergeJourney(local.journey, incoming.journey),
    };
  }

  var DEBOUNCE_MS = 1000;
  var applying = false;
  var pushing = false;
  var queued = false;
  var saveTimer = null;

  function payload() {
    return Object.assign({ app: APP, version: 1, exportedAt: new Date().toISOString() }, readAll());
  }

  function applyData(data) {
    if (!data || data.app !== APP) throw new Error("This file is not a Chinese Library backup");
    applying = true;
    try {
      var local = readAll();
      if (localStorage.getItem(APP + "-pre-import") == null) {
        localStorage.setItem(APP + "-pre-import", JSON.stringify(local));
      }
      var merged = merge(local, data);
      Object.keys(KEYS).forEach(function (k) {
        localStorage.setItem(KEYS[k], JSON.stringify(merged[k]));
      });
    } finally {
      applying = false;
    }
  }

  function stable(value) {
    if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
    if (value && typeof value === "object") {
      return "{" + Object.keys(value).sort().map(function (k) {
        return JSON.stringify(k) + ":" + stable(value[k]);
      }).join(",") + "}";
    }
    return JSON.stringify(value == null ? null : value);
  }

  function fingerprint(data) {
    data = data || {};
    return stable({
      status: data.status || {},
      srs: data.srs || {},
      journey: data.journey || {},
    });
  }

  function hasProgress(data) {
    var status = (data && data.status) || {};
    var srs = (data && data.srs) || {};
    var journey = (data && data.journey) || {};
    var first = journey.firstKnown || {};
    return Object.keys(status).length > 0 ||
      Object.keys(srs).length > 0 ||
      (journey.snapshots && journey.snapshots.length > 0) ||
      (journey.events && journey.events.length > 0) ||
      Object.keys(first).length > 0;
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function hhmm() {
    var now = new Date();
    return pad2(now.getHours()) + ":" + pad2(now.getMinutes());
  }

  function hasToken() {
    try {
      var cfg = JSON.parse(localStorage.getItem("dong-gh-sync") || "null");
      return !!(cfg && cfg.token);
    } catch (e) {
      return false;
    }
  }

  function setStatus(text) {
    var el = document.getElementById("sync-label");
    if (el) el.textContent = text;
  }

  function showConnect() {
    var el = document.getElementById("connect");
    if (el) el.hidden = hasToken();
  }

  function refreshUi() {
    try {
      if (
        global.App &&
        Array.isArray(global.App.cards) &&
        global.StatusStore &&
        typeof global.StatusStore.applyToCards === "function"
      ) {
        global.StatusStore.applyToCards(global.App.cards);
        if (typeof global.App.recomputeCounts === "function") global.App.recomputeCounts();
        if (typeof global.App.applyFilters === "function") global.App.applyFilters();
      }
      var progressView = document.getElementById("view-progress");
      if (
        progressView &&
        !progressView.hidden &&
        global.Progress &&
        typeof global.Progress.render === "function"
      ) {
        global.Progress.render();
      }
    } catch (e) {}
  }

  function schedulePush() {
    if (!hasToken() || !global.GhSync) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      saveTimer = null;
      pushNow();
    }, DEBOUNCE_MS);
  }

  function syncWithRetry(isRetry) {
    return global.GhSync.fetch(APP).then(function (remote) {
      if (remote) applyData(remote.data);
      var next = payload();
      if (remote && fingerprint(remote.data) === fingerprint(next)) return;
      if (!remote && !hasProgress(next)) return;
      return global.GhSync.write(APP, next, remote && remote.sha).catch(function (err) {
        if (!isRetry && err && err.status === 409) return syncWithRetry(true);
        throw err;
      });
    });
  }

  function pushNow() {
    if (!global.GhSync) {
      setStatus("GitHub sync failed to load.");
      showConnect();
      return Promise.resolve();
    }
    if (!hasToken()) {
      setStatus("Not synced");
      showConnect();
      return Promise.resolve();
    }
    if (pushing) {
      queued = true;
      return Promise.resolve();
    }
    pushing = true;
    setStatus("Syncing\u2026");
    var before = fingerprint(readAll());
    return syncWithRetry(false).then(function () {
      setStatus("Synced " + hhmm());
      if (fingerprint(readAll()) !== before) refreshUi();
    }, function (err) {
      setStatus(err && err.message ? err.message : "Sync failed");
    }).then(function () {
      pushing = false;
      showConnect();
      if (queued) {
        queued = false;
        schedulePush();
      }
    });
  }

  function onConnect() {
    if (!global.GhSync) {
      setStatus("GitHub sync failed to load.");
      return;
    }
    try {
      if (!hasToken()) global.GhSync.ensureConfig();
    } catch (e) {
      setStatus("Not synced");
      showConnect();
      return;
    }
    showConnect();
    pushNow();
  }

  function watchStores() {
    var nativeSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      nativeSetItem.call(this, key, value);
      if (applying || this !== localStorage) return;
      if (key !== KEYS.status && key !== KEYS.srs && key !== KEYS.journey) return;
      schedulePush();
    };
  }

  function wire() {
    watchStores();
    showConnect();
    var btn = document.getElementById("btn-connect");
    if (btn) btn.addEventListener("click", onConnect);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") return;
      showConnect();
      if (!hasToken()) {
        setStatus("Not synced");
        return;
      }
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      pushNow();
    });
    if (!global.GhSync) {
      setStatus("GitHub sync failed to load.");
      return;
    }
    if (!hasToken()) {
      setStatus("Not synced");
      return;
    }
    pushNow();
  }

  global.ChineseBackup = { merge: merge, mergeSrs: mergeSrs, mergeJourney: mergeJourney };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
    else wire();
  }
})(typeof window !== "undefined" ? window : globalThis);
