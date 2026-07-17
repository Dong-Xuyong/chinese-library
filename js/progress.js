/**
 * Progress visualizations — mastery, SRS, topics, POS, audio.
 * Depends on window.App and window.SRS.
 */
(function (global) {
  "use strict";

  var THEME_KEYWORDS = [
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

  var bound = false;

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getCards() {
    return global.App && Array.isArray(global.App.cards) ? global.App.cards : [];
  }

  function aggregate(cards) {
    var total = cards.length;
    var known = 0;
    var learning = 0;
    var withAudio = 0;
    var themes = {};
    var posMap = {};
    var posLabel = {};
    var i;

    for (i = 0; i < THEME_KEYWORDS.length; i++) themes[THEME_KEYWORDS[i]] = 0;

    for (i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (c.status === "known") known += 1;
      else learning += 1;
      if (c.audio) withAudio += 1;

      var posRaw = (c.pos || "").trim() || "other";
      var posKey = posRaw.toLowerCase();
      posMap[posKey] = (posMap[posKey] || 0) + 1;
      if (!posLabel[posKey]) posLabel[posKey] = posRaw;

      var kws = Array.isArray(c.keywords) ? c.keywords : [];
      for (var t = 0; t < THEME_KEYWORDS.length; t++) {
        if (kws.indexOf(THEME_KEYWORDS[t]) !== -1) {
          themes[THEME_KEYWORDS[t]] += 1;
        }
      }
    }

    var themeBars = THEME_KEYWORDS.map(function (k) {
      return { key: k, count: themes[k] || 0 };
    }).sort(function (a, b) {
      return b.count - a.count;
    });

    var posBars = Object.keys(posMap)
      .map(function (k) {
        return { key: posLabel[k] || k, count: posMap[k] };
      })
      .sort(function (a, b) {
        return b.count - a.count;
      })
      .slice(0, 8);

    var ids = cards.map(function (c) {
      return c.id;
    });
    var srs =
      global.SRS && typeof global.SRS.stats === "function"
        ? global.SRS.stats(ids)
        : { due: 0, new: 0, learning: 0, review: 0 };

    return {
      total: total,
      known: known,
      learning: learning,
      knownPct: total ? Math.round((known / total) * 100) : 0,
      withAudio: withAudio,
      withoutAudio: Math.max(0, total - withAudio),
      audioPct: total ? Math.round((withAudio / total) * 100) : 0,
      themes: themeBars,
      pos: posBars,
      srs: srs,
    };
  }

  function donutSvg(known, learning) {
    var total = known + learning;
    if (!total) {
      return (
        '<svg class="progress-donut" viewBox="0 0 120 120" aria-hidden="true">' +
        '<circle cx="60" cy="60" r="46" fill="none" stroke="var(--ink-line)" stroke-width="12"/>' +
        "</svg>"
      );
    }
    var C = 2 * Math.PI * 46;
    var knownLen = (known / total) * C;
    var learnLen = C - knownLen;
    return (
      '<svg class="progress-donut" viewBox="0 0 120 120" role="img" aria-label="' +
      known +
      " known, " +
      learning +
      ' learning">' +
      '<circle class="donut-track" cx="60" cy="60" r="46" fill="none" stroke-width="12"/>' +
      '<circle class="donut-known" cx="60" cy="60" r="46" fill="none" stroke-width="12" ' +
      'stroke-dasharray="' +
      knownLen.toFixed(2) +
      " " +
      C.toFixed(2) +
      '" stroke-dashoffset="0" transform="rotate(-90 60 60)"/>' +
      '<circle class="donut-learning" cx="60" cy="60" r="46" fill="none" stroke-width="12" ' +
      'stroke-dasharray="' +
      learnLen.toFixed(2) +
      " " +
      C.toFixed(2) +
      '" stroke-dashoffset="' +
      (-knownLen).toFixed(2) +
      '" transform="rotate(-90 60 60)"/>' +
      '<text x="60" y="56" text-anchor="middle" class="donut-pct">' +
      (total ? Math.round((known / total) * 100) : 0) +
      "%</text>" +
      '<text x="60" y="74" text-anchor="middle" class="donut-sub">known</text>' +
      "</svg>"
    );
  }

  function barRows(items, total, dataAttr) {
    if (!items.length) {
      return '<p class="progress-empty">No data yet.</p>';
    }
    var max = Math.max.apply(
      null,
      items.map(function (it) {
        return it.count;
      }).concat([1])
    );
    return items
      .map(function (it) {
        var pctOfMax = Math.round((it.count / max) * 100);
        var pctOfTotal = total ? Math.round((it.count / total) * 100) : 0;
        return (
          '<button type="button" class="progress-bar-row" data-' +
          dataAttr +
          '="' +
          escapeHtml(it.key) +
          '">' +
          '<span class="progress-bar-label">' +
          escapeHtml(it.key) +
          "</span>" +
          '<span class="progress-bar-track" aria-hidden="true">' +
          '<span class="progress-bar-fill" style="width:' +
          pctOfMax +
          '%"></span>' +
          "</span>" +
          '<span class="progress-bar-value">' +
          it.count +
          " · " +
          pctOfTotal +
          "%</span>" +
          "</button>"
        );
      })
      .join("");
  }

  function srsMeter(srs) {
    var parts = [
      { key: "due", label: "Due", value: srs.due || 0, cls: "srs-due" },
      { key: "new", label: "New", value: srs.new || 0, cls: "srs-new" },
      {
        key: "learning",
        label: "Learning",
        value: srs.learning || 0,
        cls: "srs-learning",
      },
      {
        key: "review",
        label: "Review",
        value: srs.review || 0,
        cls: "srs-review",
      },
    ];
    var max = Math.max.apply(
      null,
      parts.map(function (p) {
        return p.value;
      }).concat([1])
    );
    return (
      '<div class="srs-grid">' +
      parts
        .map(function (p) {
          var w = Math.round((p.value / max) * 100);
          return (
            '<div class="srs-cell ' +
            p.cls +
            '">' +
            '<span class="srs-value">' +
            p.value +
            "</span>" +
            '<span class="srs-label">' +
            p.label +
            "</span>" +
            '<span class="srs-mini-track" aria-hidden="true"><span style="width:' +
            w +
            '%"></span></span>' +
            "</div>"
          );
        })
        .join("") +
      "</div>" +
      '<button type="button" class="btn btn-primary btn-block" id="progress-study-due">Study due cards</button>'
    );
  }

  function renderHtml(data) {
    return (
      '<div class="progress-grid">' +
      '<article class="progress-card progress-card-mastery">' +
      "<h2>Mastery</h2>" +
      '<div class="mastery-wrap">' +
      donutSvg(data.known, data.learning) +
      '<ul class="mastery-legend">' +
      "<li><span class=\"swatch swatch-known\"></span> Known <strong>" +
      data.known +
      "</strong></li>" +
      "<li><span class=\"swatch swatch-learning\"></span> Learning <strong>" +
      data.learning +
      "</strong></li>" +
      "<li class=\"mastery-total\">Total <strong>" +
      data.total +
      "</strong></li>" +
      "</ul></div></article>" +
      '<article class="progress-card progress-card-srs">' +
      "<h2>SRS today</h2>" +
      srsMeter(data.srs) +
      "</article>" +
      '<article class="progress-card progress-card-audio">' +
      "<h2>Audio coverage</h2>" +
      '<div class="audio-meter" role="img" aria-label="' +
      data.audioPct +
      "% with audio\">" +
      '<div class="audio-meter-fill" style="width:' +
      data.audioPct +
      '%"></div></div>' +
      '<p class="audio-meter-caption"><strong>' +
      data.withAudio +
      "</strong> with recording · <strong>" +
      data.withoutAudio +
      "</strong> speech fallback · <strong>" +
      data.audioPct +
      "%</strong></p></article>" +
      '<article class="progress-card progress-card-topics">' +
      "<h2>Topics</h2>" +
      '<p class="progress-hint">Tap a topic to open it in Library</p>' +
      '<div class="progress-bars" id="progress-topics">' +
      barRows(data.themes, data.total, "topic") +
      "</div></article>" +
      '<article class="progress-card progress-card-pos">' +
      "<h2>Parts of speech</h2>" +
      '<p class="progress-hint">Tap a POS to filter Library</p>' +
      '<div class="progress-bars" id="progress-pos">' +
      barRows(data.pos, data.total, "pos") +
      "</div></article>" +
      "</div>"
    );
  }

  function wireInteractions(root) {
    if (!root) return;

    root.querySelectorAll("[data-topic]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var topic = btn.getAttribute("data-topic") || "";
        if (global.App && typeof global.App.filterByTopic === "function") {
          global.App.filterByTopic(topic);
        } else if (global.App && typeof global.App.setKeywordFilter === "function") {
          global.App.setKeywordFilter(topic);
          if (typeof global.App.showTab === "function") global.App.showTab("library");
        }
      });
    });

    root.querySelectorAll("[data-pos]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var pos = btn.getAttribute("data-pos") || "";
        if (global.App && typeof global.App.filterByPos === "function") {
          global.App.filterByPos(pos);
        }
      });
    });

    var studyBtn = $("progress-study-due");
    if (studyBtn) {
      studyBtn.addEventListener("click", function () {
        if (typeof global.App.showTab === "function") {
          global.App.showTab("study");
        }
        history.replaceState(null, "", "#study");
      });
    }
  }

  function render() {
    var root = $("progress-root");
    if (!root) return false;
    try {
      var cards = getCards();
      if (!cards.length) {
        root.innerHTML =
          '<p class="progress-empty">Load vocabulary to see progress charts.</p>';
        return false;
      }
      var data = aggregate(cards);
      root.innerHTML = renderHtml(data);
      wireInteractions(root);
      return true;
    } catch (err) {
      console.error("Progress.render failed:", err);
      root.innerHTML =
        '<p class="progress-empty">Could not render charts. ' +
        escapeHtml(err && err.message ? err.message : "Unknown error") +
        "</p>";
      return false;
    }
  }

  function init() {
    if (bound) return;
    bound = true;

    window.addEventListener("hashchange", function () {
      if ((location.hash || "").replace(/^#/, "") === "progress") render();
    });

    // Retry until vocab is loaded (covers race with app.js fetch)
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      if (render() || tries >= 60) clearInterval(timer);
    }, 100);

    document.querySelectorAll('.tab-bar .tab[data-tab="progress"]').forEach(function (tab) {
      tab.addEventListener("click", function () {
        setTimeout(render, 0);
      });
    });
  }

  global.Progress = {
    init: init,
    render: render,
  };

  // Defer scripts run after DOM parse — boot immediately
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : globalThis);
