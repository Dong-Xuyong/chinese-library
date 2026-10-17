/**
 * Cross-device progress sync. On load, remote and local stores are merged.
 * Later edits are saved to GitHub in one batch, a few seconds after the last change.
 * The library paints from bundled data and this device's cache before that request starts.
 */
(function (global) {
  "use strict";

  var APP = "chinese-library";
  var KEYS = {
    status: "ml-chinese-status-v1",
    srs: "ml-chinese-srs-v1",
    journey: "ml-chinese-journey-v1",
    // Optional. Older files omit it and still load.
    // reviewedToday is not stored here: the hub sums journey.events[].count
    // for type "study" dated today in Europe/Lisbon, else counts srs.*.last.
    game: "ml-chinese-game-v1",
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

  function asMap(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value;
  }

  function newerCard(a, b) {
    if (!a || typeof a !== "object" || Array.isArray(a)) return b;
    if (!b || typeof b !== "object" || Array.isArray(b)) return a;
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
    local = local || {};
    incoming = incoming || {};
    var merged = {
      status: Object.assign({}, asMap(local.status), asMap(incoming.status)),
      srs: mergeSrs(asMap(local.srs), asMap(incoming.srs)),
      journey: mergeJourney(local.journey, incoming.journey),
    };
    var game = global.Daily && typeof global.Daily.mergeGame === "function"
      ? global.Daily.mergeGame(local.game, incoming.game, merged.journey)
      : (incoming.game || local.game || null);
    if (game) merged.game = game;
    return merged;
  }

  function overlayWrite(remoteData, next) {
    var base = remoteData && typeof remoteData === "object" ? Object.assign({}, remoteData) : {};
    Object.keys(next || {}).forEach(function (key) {
      if (next[key] !== undefined) base[key] = next[key];
    });
    return base;
  }

  var DEBOUNCE_MS = 8000;
  var applying = false;
  var pushing = false;
  var queued = false;
  var saveTimer = null;

  function payload() {
    var all = readAll();
    var body = {
      app: APP,
      version: 1,
      exportedAt: new Date().toISOString(),
      status: all.status || {},
      srs: all.srs || {},
      journey: all.journey || { snapshots: [], events: [], firstKnown: {} },
    };
    if (all.game && typeof all.game === "object" && !Array.isArray(all.game)) body.game = all.game;
    return body;
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
        if (merged[k] == null) return;
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
      game: data.game || null,
    });
  }

  function hasProgress(data) {
    var status = (data && data.status) || {};
    var srs = (data && data.srs) || {};
    var journey = (data && data.journey) || {};
    var first = journey.firstKnown || {};
    var game = (data && data.game) || {};
    return Object.keys(status).length > 0 ||
      Object.keys(srs).length > 0 ||
      (journey.snapshots && journey.snapshots.length > 0) ||
      (journey.events && journey.events.length > 0) ||
      Object.keys(first).length > 0 ||
      game.xp > 0 ||
      game.streak > 0 ||
      !!game.lastGoalDate ||
      game.combo > 0 ||
      game.bestCombo > 0;
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

  function setStatus(text, title) {
    var el = document.getElementById("sync-label");
    if (!el) return;
    el.textContent = text;
    if (title && title !== text) el.title = title;
    else el.removeAttribute("title");
  }

  function describeSyncError(err) {
    var status = err && err.status;
    var raw = err && err.message ? err.message : "Sync failed";
    if (status === 401 || /token rejected/i.test(raw)) return { label: "Token rejected", title: raw };
    if (status === 403 || /access denied/i.test(raw)) return { label: "Access denied", title: raw };
    if (status === 409 || /another device/i.test(raw)) return { label: "Sync conflict", title: raw };
    if (!status && /could not reach|offline|failed to fetch|network/i.test(raw)) {
      return { label: "Offline", title: raw };
    }
    if ((err && err.name === "AbortError") || /timed out/i.test(raw)) return { label: "Sync timed out", title: raw };
    if ((err && err.name === "SyntaxError") || /could not be read|not a Chinese Library backup/i.test(raw)) {
      return { label: "Sync unreadable", title: raw };
    }
    if (status) return { label: "GitHub " + status, title: raw };
    return { label: "Sync failed", title: raw };
  }

  function showConnect() {
    var el = document.getElementById("connect");
    if (el) el.hidden = hasToken();
  }

  function refreshUi() {
    try {
      if (global.App && typeof global.App.applyRemoteProgress === "function") {
        global.App.applyRemoteProgress();
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

  function remoteBackup(data) {
    return !!(data && data.app === APP);
  }

  // gh-sync.js owns the single 409 retry (GhSync.sync); this file never retries itself.
  function syncOnce() {
    return global.GhSync.sync(APP, function (remote) {
      if (remote && remote.data && remote.data.app && remote.data.app !== APP) {
        throw new Error("This file is not a Chinese Library backup");
      }
      if (remote && remoteBackup(remote.data)) applyData(remote.data);
      var base = remote && remoteBackup(remote.data) ? remote.data : null;
      var next = overlayWrite(base, payload());
      if (remote && remoteBackup(remote.data) && fingerprint(remote.data) === fingerprint(next)) return undefined;
      if (!remote && !hasProgress(next)) return undefined;
      return next;
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
    return syncOnce().then(function () {
      setStatus("Synced " + hhmm());
      if (fingerprint(readAll()) !== before) refreshUi();
      return true;
    }, function (err) {
      var described = describeSyncError(err);
      setStatus(described.label, described.title);
      return false;
    }).then(function (ok) {
      pushing = false;
      showConnect();
      if (!queued) return;
      queued = false;
      clearTimeout(saveTimer);
      saveTimer = null;
      if (!ok) {
        schedulePush();
        return;
      }
      pushNow();
    });
  }

  function flushPendingSync() {
    if (global.App && typeof global.App.flushPersist === "function") {
      global.App.flushPersist();
    }
    clearTimeout(saveTimer);
    saveTimer = null;
    if (pushing) {
      queued = true;
      return;
    }
    pushNow();
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
      if (key !== KEYS.status && key !== KEYS.srs && key !== KEYS.journey && key !== KEYS.game) return;
      schedulePush();
    };
  }

  var syncArmed = false;

  function armSync() {
    if (syncArmed) return;
    syncArmed = true;
    if (!global.GhSync) {
      setStatus("GitHub sync failed to load.");
      showConnect();
      return;
    }
    if (!hasToken()) {
      setStatus("Not synced");
      showConnect();
      return;
    }
    pushNow();
  }

  function wire() {
    watchStores();
    showConnect();
    var btn = document.getElementById("btn-connect");
    if (btn) btn.addEventListener("click", onConnect);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        flushPendingSync();
        return;
      }
      showConnect();
      if (!hasToken()) {
        setStatus("Not synced");
        return;
      }
      flushPendingSync();
    });
    window.addEventListener("pagehide", flushPendingSync);
    if (!global.GhSync) {
      setStatus("GitHub sync failed to load.");
      return;
    }
    if (!hasToken()) {
      setStatus("Not synced");
      return;
    }
    // Words come from the bundled library plus local cache. Sync starts only
    // after that first paint, so a slow or hung GitHub request cannot hold the shelves.
    if (global.App && Array.isArray(global.App.cards) && global.App.cards.length) {
      armSync();
    } else {
      document.addEventListener("ml-library-ready", armSync);
      setTimeout(armSync, 20000);
    }
  }

  global.ChineseBackup = {
    merge: merge,
    mergeSrs: mergeSrs,
    mergeJourney: mergeJourney,
    overlayWrite: overlayWrite,
    fingerprint: fingerprint,
    payload: payload,
    pushNow: pushNow,
  };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
    else wire();
  }
})(typeof window !== "undefined" ? window : globalThis);
