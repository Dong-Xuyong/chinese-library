/**
 * Cross-device progress backup: export the three local stores, import merges them.
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

  function payload() {
    return Object.assign({ app: APP, version: 1, exportedAt: new Date().toISOString() }, readAll());
  }

  function applyData(data) {
    if (!data || data.app !== APP) throw new Error("This file is not a Chinese Library backup");
    var local = readAll();
    if (localStorage.getItem(APP + "-pre-import") == null) {
      localStorage.setItem(APP + "-pre-import", JSON.stringify(local));
    }
    var merged = merge(local, data);
    Object.keys(KEYS).forEach(function (k) {
      localStorage.setItem(KEYS[k], JSON.stringify(merged[k]));
    });
  }

  function exportFile() {
    var blob = new Blob([JSON.stringify(payload())], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = APP + "-progress-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function importText(text) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      alert("Not a valid JSON file");
      return;
    }
    try {
      applyData(data);
    } catch (e) {
      alert(e.message);
      return;
    }
    alert("Merged " + Object.keys(data.srs || {}).length + " study cards from backup");
    location.reload();
  }

  function githubSync(mode) {
    if (!global.GhSync) return alert("GitHub sync unavailable");
    var run = mode === "save" ? global.GhSync.save(APP, payload, applyData) : global.GhSync.load(APP, applyData);
    run.then(
      function (msg) {
        alert(msg);
        location.reload();
      },
      function (e) {
        alert(e.message);
      }
    );
  }

  function wire() {
    var file = document.getElementById("import-progress-file");
    var exp = document.getElementById("export-progress");
    var imp = document.getElementById("import-progress");
    if (!file || !exp || !imp) return;
    exp.addEventListener("click", exportFile);
    imp.addEventListener("click", function () { file.click(); });
    var ghSave = document.getElementById("github-save");
    var ghLoad = document.getElementById("github-load");
    if (ghSave) ghSave.addEventListener("click", function () { githubSync("save"); });
    if (ghLoad) ghLoad.addEventListener("click", function () { githubSync("load"); });
    file.addEventListener("change", function () {
      var f = file.files && file.files[0];
      if (f) f.text().then(importText);
      file.value = "";
    });
  }

  global.ChineseBackup = { merge: merge, mergeSrs: mergeSrs, mergeJourney: mergeJourney };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
    else wire();
  }
})(typeof window !== "undefined" ? window : globalThis);
