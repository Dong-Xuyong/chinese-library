/**
 * Progress visualizations — journey curve/timeline, mastery, SRS, topics, POS, audio.
 * Depends on window.App, window.SRS, window.JourneyStore.
 */
(function (global) {
  "use strict";

  var JOURNEY_URL = "./data/journey.json";
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
  var journeyData = null;
  var journeyFetch = null;

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

  function ensureJourney() {
    if (journeyData) return Promise.resolve(journeyData);
    if (journeyFetch) return journeyFetch;
    journeyFetch = fetch(JOURNEY_URL)
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        journeyData = data && typeof data === "object" ? data : { series: [], milestones: [] };
        return journeyData;
      })
      .catch(function (err) {
        console.warn("Journey fetch failed:", err);
        journeyData = { series: [], milestones: [] };
        return journeyData;
      });
    return journeyFetch;
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

    // Known words are mastered — exclude them from SRS due / study counts.
    var ids = cards
      .filter(function (c) {
        return c.status !== "known";
      })
      .map(function (c) {
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

  function seriesPath(points, key, x0, y0, w, h, maxY) {
    if (!points.length || maxY <= 0) return "";
    return points
      .map(function (p, i) {
        var x = x0 + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
        var y = y0 + h - (Number(p[key]) / maxY) * h;
        return (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1);
      })
      .join(" ");
  }

  function curveSvg(series) {
    if (!series.length) {
      return '<p class="progress-empty">No journey history yet.</p>';
    }
    var W = 320;
    var H = 160;
    var padL = 36;
    var padR = 12;
    var padT = 14;
    var padB = 28;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;
    var maxY = 1;
    var i;
    for (i = 0; i < series.length; i++) {
      maxY = Math.max(maxY, series[i].total || 0, series[i].known || 0, series[i].learning || 0);
    }
    // nice ceiling
    maxY = Math.ceil(maxY / 100) * 100 || 100;

    var totalPath = seriesPath(series, "total", padL, padT, plotW, plotH, maxY);
    var knownPath = seriesPath(series, "known", padL, padT, plotW, plotH, maxY);
    var learnPath = seriesPath(series, "learning", padL, padT, plotW, plotH, maxY);

    var first = series[0];
    var last = series[series.length - 1];
    var mid = series[Math.floor(series.length / 2)];

    var dots = series
      .map(function (p, idx) {
        var x = padL + (series.length === 1 ? plotW / 2 : (idx / (series.length - 1)) * plotW);
        var y = padT + plotH - (Number(p.known) / maxY) * plotH;
        return (
          '<circle class="journey-dot" cx="' +
          x.toFixed(1) +
          '" cy="' +
          y.toFixed(1) +
          '" r="3.2" data-tip="' +
          escapeHtml(p.date) +
          ": known " +
          p.known +
          ", learning " +
          p.learning +
          ", total " +
          p.total +
          '">' +
          "<title>" +
          escapeHtml(p.date) +
          ": known " +
          p.known +
          ", learning " +
          p.learning +
          ", total " +
          p.total +
          "</title></circle>"
        );
      })
      .join("");

    return (
      '<svg class="journey-curve" viewBox="0 0 ' +
      W +
      " " +
      H +
      '" role="img" aria-label="Learning curve from ' +
      escapeHtml(first.date) +
      " to " +
      escapeHtml(last.date) +
      '">' +
      '<line class="journey-grid" x1="' +
      padL +
      '" y1="' +
      (padT + plotH) +
      '" x2="' +
      (padL + plotW) +
      '" y2="' +
      (padT + plotH) +
      '"/>' +
      '<line class="journey-grid" x1="' +
      padL +
      '" y1="' +
      padT +
      '" x2="' +
      padL +
      '" y2="' +
      (padT + plotH) +
      '"/>' +
      '<text class="journey-axis" x="' +
      (padL - 6) +
      '" y="' +
      (padT + 4) +
      '" text-anchor="end">' +
      maxY +
      "</text>" +
      '<text class="journey-axis" x="' +
      (padL - 6) +
      '" y="' +
      (padT + plotH) +
      '" text-anchor="end">0</text>' +
      '<path class="journey-line journey-line-total" d="' +
      totalPath +
      '" fill="none"/>' +
      '<path class="journey-line journey-line-learning" d="' +
      learnPath +
      '" fill="none"/>' +
      '<path class="journey-line journey-line-known" d="' +
      knownPath +
      '" fill="none"/>' +
      dots +
      '<text class="journey-axis journey-x" x="' +
      padL +
      '" y="' +
      (H - 8) +
      '">' +
      escapeHtml(first.date.slice(0, 7)) +
      "</text>" +
      '<text class="journey-axis journey-x" x="' +
      (padL + plotW / 2) +
      '" y="' +
      (H - 8) +
      '" text-anchor="middle">' +
      escapeHtml(mid.date.slice(0, 7)) +
      "</text>" +
      '<text class="journey-axis journey-x" x="' +
      (padL + plotW) +
      '" y="' +
      (H - 8) +
      '" text-anchor="end">' +
      escapeHtml(last.date.slice(0, 7)) +
      "</text>" +
      "</svg>"
    );
  }

  function formatEventLabel(evt) {
    if (!evt) return "";
    if (evt.type === "known") return "Marked " + (evt.label || evt.id || "a word") + " as known";
    if (evt.type === "learning") return "Marked " + (evt.label || evt.id || "a word") + " as learning";
    if (evt.type === "study") {
      if (evt.label) return evt.label;
      return "Studied " + (evt.count || 1) + " cards";
    }
    return evt.label || evt.type;
  }

  function timelineHtml(milestones, localEvents) {
    var items = [];
    var i;
    for (i = 0; i < (milestones || []).length; i++) {
      var m = milestones[i];
      items.push({
        date: m.date,
        title: m.title,
        detail: m.detail || "",
        kind: "milestone",
      });
    }
    for (i = 0; i < (localEvents || []).length; i++) {
      var e = localEvents[i];
      items.push({
        date: e.date,
        title: formatEventLabel(e),
        detail: e.type === "known" || e.type === "learning" ? "Saved on this phone" : "Study activity",
        kind: "local",
        id: e.id,
      });
    }
    items.sort(function (a, b) {
      if (a.date === b.date) {
        if (a.kind === b.kind) return 0;
        return a.kind === "local" ? -1 : 1;
      }
      return a.date < b.date ? 1 : -1;
    });
    items = items.slice(0, 14);
    if (!items.length) {
      return '<p class="progress-empty">Timeline will fill as you study and mark words known.</p>';
    }
    return (
      '<ol class="journey-timeline">' +
      items
        .map(function (it) {
          var title = escapeHtml(it.title);
          if (it.id) {
            title =
              '<button type="button" class="journey-link" data-word-id="' +
              escapeHtml(it.id) +
              '">' +
              title +
              "</button>";
          }
          return (
            '<li class="journey-timeline-item journey-' +
            it.kind +
            '">' +
            '<time class="journey-time" datetime="' +
            escapeHtml(it.date) +
            '">' +
            escapeHtml(it.date) +
            "</time>" +
            '<div class="journey-timeline-body">' +
            '<p class="journey-timeline-title">' +
            title +
            "</p>" +
            (it.detail
              ? '<p class="journey-timeline-detail">' + escapeHtml(it.detail) + "</p>"
              : "") +
            "</div></li>"
          );
        })
        .join("") +
      "</ol>"
    );
  }

  function recentMasteredHtml(entries, cards) {
    if (!entries || !entries.length) {
      return '<p class="progress-hint journey-recent-empty">Mark words as known to track them here.</p>';
    }
    var byId = {};
    for (var i = 0; i < cards.length; i++) byId[cards[i].id] = cards[i];
    return (
      '<div class="journey-recent" aria-label="Recently mastered on this device">' +
      entries
        .map(function (e) {
          var card = byId[e.id];
          var label = card ? card.hanzi : e.id;
          return (
            '<button type="button" class="journey-chip" data-word-id="' +
            escapeHtml(e.id) +
            '" title="' +
            escapeHtml(e.date) +
            '">' +
            escapeHtml(label) +
            "</button>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function journeyHtml(built, cards) {
    var series = [];
    if (global.JourneyStore && typeof global.JourneyStore.mergeSeries === "function") {
      series = global.JourneyStore.mergeSeries(built.series || []);
    } else {
      series = Array.isArray(built.series) ? built.series.slice() : [];
    }

    var localEvents =
      global.JourneyStore && typeof global.JourneyStore.recentEvents === "function"
        ? global.JourneyStore.recentEvents(10)
        : [];
    var recent =
      global.JourneyStore && typeof global.JourneyStore.recentFirstKnown === "function"
        ? global.JourneyStore.recentFirstKnown(8)
        : [];

    var last = series.length ? series[series.length - 1] : null;
    var first = series.length ? series[0] : null;
    var deltaKnown =
      first && last ? Number(last.known) - Number(first.known) : 0;
    var deltaLabel =
      deltaKnown >= 0 ? "+" + deltaKnown + " known" : deltaKnown + " known";

    return (
      '<article class="progress-card progress-card-journey">' +
      "<h2>Learning journey</h2>" +
      '<p class="progress-hint">History from vault · From today saved on this phone</p>' +
      '<div class="journey-legend" aria-hidden="true">' +
      '<span><i class="swatch swatch-known"></i> Known</span>' +
      '<span><i class="swatch swatch-learning"></i> Learning</span>' +
      '<span><i class="swatch swatch-total"></i> Total</span>' +
      "</div>" +
      '<div class="journey-curve-wrap">' +
      curveSvg(series) +
      "</div>" +
      (last
        ? '<p class="journey-summary"><strong>' +
          last.known +
          "</strong> known · <strong>" +
          last.learning +
          "</strong> learning · <strong>" +
          last.total +
          "</strong> total · <span class=\"journey-delta\">" +
          escapeHtml(deltaLabel) +
          " since " +
          escapeHtml(first.date.slice(0, 7)) +
          "</span></p>"
        : "") +
      "<h3 class=\"journey-subhead\">Recently mastered</h3>" +
      recentMasteredHtml(recent, cards) +
      '<h3 class="journey-subhead">Timeline</h3>' +
      timelineHtml(built.milestones || [], localEvents) +
      "</article>"
    );
  }

  function renderHtml(data, built, cards) {
    return (
      '<div class="progress-grid">' +
      journeyHtml(built || { series: [], milestones: [] }, cards) +
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

    root.querySelectorAll("[data-word-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-word-id") || "";
        if (!id) return;
        if (global.App && typeof global.App.openDetail === "function") {
          if (typeof global.App.showTab === "function") global.App.showTab("library");
          global.App.openDetail(id);
        } else {
          location.hash = "#word/" + encodeURIComponent(id);
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
    var cards = getCards();
    if (!cards.length) {
      root.innerHTML =
        '<p class="progress-empty">Load vocabulary to see progress charts.</p>';
      return false;
    }

    if (global.JourneyStore && typeof global.JourneyStore.recordSnapshot === "function") {
      global.JourneyStore.recordSnapshot(cards);
    }

    var data = aggregate(cards);

    ensureJourney().then(function (built) {
      try {
        root.innerHTML = renderHtml(data, built, cards);
        wireInteractions(root);
      } catch (err) {
        console.error("Progress.render failed:", err);
        root.innerHTML =
          '<p class="progress-empty">Could not render charts. ' +
          escapeHtml(err && err.message ? err.message : "Unknown error") +
          "</p>";
      }
    });
    return true;
  }

  function init() {
    if (bound) return;
    bound = true;
    ensureJourney();

    window.addEventListener("hashchange", function () {
      if ((location.hash || "").replace(/^#/, "") === "progress") render();
    });

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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(typeof window !== "undefined" ? window : globalThis);
