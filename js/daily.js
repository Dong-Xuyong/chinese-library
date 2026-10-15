/**
 * Practice daily goal. The 7/20 count matches the phone hub.
 *
 * reviewedToday, same rule as hub.js chineseReviewedToday:
 *   1. If journey.events is an array, sum `count` on events with
 *      type "study" whose `date` is today in Europe/Lisbon.
 *      A missing or non-positive count contributes 1.
 *      Field path: journey.events[].count
 *      Date path:  journey.events[].date  ("YYYY-MM-DD", Lisbon)
 *   2. Otherwise count srs cards whose `last` falls today in Lisbon.
 *      Field path: srs.<cardId>.last  (Unix epoch milliseconds)
 *
 * The study event shape stays { date, type: "study", label, count }.
 * One rolling event per Lisbon day; each rating adds 1 to count.
 * SRS.review keeps writing `last`.
 *
 * Game state is synced as chinese-library.json `game` and is optional:
 *   game.xp, game.streak, game.lastGoalDate, game.combo, game.comboAt,
 *   game.bestCombo, game.celebratedDate
 * 10 XP per rating. Level is 1 + floor(xp / 100). A day counts toward the
 * streak when that day's study count reaches 20. Old files without `game`
 * still load; merge never drops status, srs, or journey.
 *
 * remaining = min(due, max(0, 20 - reviewedToday))
 * due = learning cards with no SRS row, or srs[id].due <= now.
 */
(function (global) {
  "use strict";

  var GAME_KEY = "ml-chinese-game-v1";
  var GOAL = 20;
  var XP_PER_CARD = 10;
  var XP_PER_LEVEL = 100;
  var ZONE = "Europe/Lisbon";
  var RATINGS = { again: true, hard: true, good: true, easy: true };
  var RING_RADIUS = 46;
  var RING_CIRC = 2 * Math.PI * RING_RADIUS;

  function num(value) {
    return typeof value === "number" && isFinite(value) ? value : 0;
  }

  function isPlain(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function lisbonDay(date) {
    var instant = date instanceof Date ? date : new Date(date);
    var formatted = new Intl.DateTimeFormat("en-CA", {
      timeZone: ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instant);
    if (/^\d{4}-\d{2}-\d{2}$/.test(formatted)) return formatted;
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
    var y = "";
    var m = "";
    var d = "";
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].type === "year") y = parts[i].value;
      if (parts[i].type === "month") m = parts[i].value;
      if (parts[i].type === "day") d = parts[i].value;
    }
    return y + "-" + m + "-" + d;
  }

  function shiftDay(day, delta) {
    var bits = String(day || "").split("-");
    if (bits.length !== 3) return "";
    var utc = new Date(Date.UTC(+bits[0], +bits[1] - 1, +bits[2]));
    if (isNaN(utc.getTime())) return "";
    utc.setUTCDate(utc.getUTCDate() + delta);
    var month = String(utc.getUTCMonth() + 1);
    var date = String(utc.getUTCDate());
    if (month.length < 2) month = "0" + month;
    if (date.length < 2) date = "0" + date;
    return utc.getUTCFullYear() + "-" + month + "-" + date;
  }

  function dayStamp(value) {
    if (typeof value !== "string") return "";
    var day = value.trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "";
  }

  function finiteNumber(value) {
    if (typeof value === "number" && isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && isFinite(+value)) return +value;
    return null;
  }

  function epochMs(value) {
    var n = finiteNumber(value);
    if (n == null) return null;
    if (n > 0 && n < 1e12) return n * 1000;
    return n;
  }

  /**
   * Hub chineseReviewedToday. Returns a number, or null when neither
   * journey.events nor any srs.last timestamp is stored.
   */
  function reviewedTodayFrom(journey, srs, now) {
    var instant = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    var today = lisbonDay(instant);
    var events = isPlain(journey) ? journey.events : null;
    var count = 0;
    var saw = false;
    var i;
    if (Array.isArray(events)) {
      for (i = 0; i < events.length; i++) {
        var ev = events[i];
        var n;
        if (!isPlain(ev) || ev.type !== "study") continue;
        if (dayStamp(ev.date) !== today) continue;
        n = finiteNumber(ev.count);
        count += n != null && n > 0 ? n : 1;
      }
      return count;
    }
    if (!isPlain(srs)) return null;
    Object.keys(srs).forEach(function (key) {
      var card = srs[key];
      var last;
      if (!isPlain(card) || !Object.prototype.hasOwnProperty.call(card, "last")) return;
      last = epochMs(card.last);
      if (last == null) return;
      saw = true;
      if (lisbonDay(new Date(last)) === today) count += 1;
    });
    return saw ? count : null;
  }

  function currentJourney() {
    if (global.JourneyStore && typeof global.JourneyStore.load === "function") {
      return global.JourneyStore.load();
    }
    return null;
  }

  function currentSrs() {
    if (global.SRS && typeof global.SRS.load === "function") return global.SRS.load();
    return null;
  }

  function reviewedToday(now) {
    var n = reviewedTodayFrom(currentJourney(), currentSrs(), now);
    return n == null ? 0 : n;
  }

  function countsByDay(journey) {
    var events = isPlain(journey) && Array.isArray(journey.events) ? journey.events : [];
    var map = {};
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var day;
      var n;
      if (!isPlain(ev) || ev.type !== "study") continue;
      day = dayStamp(ev.date);
      if (!day) continue;
      n = finiteNumber(ev.count);
      map[day] = (map[day] || 0) + (n != null && n > 0 ? n : 1);
    }
    return map;
  }

  function streakFromJourney(journey, now) {
    var instant = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    var today = lisbonDay(instant);
    var map = countsByDay(journey);
    var cursor = map[today] >= GOAL ? today : shiftDay(today, -1);
    var streak = 0;
    if (!cursor || !(map[cursor] >= GOAL)) return 0;
    while (map[cursor] >= GOAL) {
      streak += 1;
      cursor = shiftDay(cursor, -1);
      if (!cursor || streak > 5000) break;
    }
    return streak;
  }

  function remaining(due, reviewed) {
    var room = GOAL - num(reviewed);
    if (room < 0) room = 0;
    var pending = num(due);
    if (pending < 0) pending = 0;
    return pending < room ? pending : room;
  }

  function levelFor(xp) {
    return 1 + Math.floor(num(xp) / XP_PER_LEVEL);
  }

  function dueCount(cards, now) {
    var list = Array.isArray(cards) ? cards : [];
    var ids = [];
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && list[i].id && list[i].status !== "known") ids.push(list[i].id);
    }
    if (global.SRS && typeof global.SRS.dueCards === "function") {
      return global.SRS.dueCards(ids, now == null ? Date.now() : now).length;
    }
    return ids.length;
  }

  function loadGame() {
    try {
      var raw = localStorage.getItem(GAME_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return isPlain(parsed) ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function saveGame(game) {
    localStorage.setItem(GAME_KEY, JSON.stringify(game || {}));
  }

  function applyGoal(game, journey, now) {
    var instant = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    var today = lisbonDay(instant);
    var counts = countsByDay(journey);
    if ((counts[today] || 0) < GOAL) return false;
    if (game.lastGoalDate === today) return false;
    var yesterday = shiftDay(today, -1);
    var fromLog = streakFromJourney(journey, instant);
    if (game.lastGoalDate === yesterday) game.streak = Math.max(num(game.streak) + 1, fromLog);
    else game.streak = Math.max(1, fromLog);
    game.lastGoalDate = today;
    var firstToday = game.celebratedDate !== today;
    game.celebratedDate = today;
    return firstToday;
  }

  function noteGoal(game, now) {
    return applyGoal(game, currentJourney(), now);
  }

  function displayStreak(game, now) {
    var instant = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    var today = lisbonDay(instant);
    var fromLog = streakFromJourney(currentJourney(), instant);
    var stored = 0;
    if (isPlain(game) && (game.lastGoalDate === today || game.lastGoalDate === shiftDay(today, -1))) {
      stored = num(game.streak);
    }
    return stored > fromLog ? stored : fromLog;
  }

  function displayCombo(game, now) {
    if (!isPlain(game) || num(game.combo) < 1 || !num(game.comboAt)) return 0;
    var instant = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    if (lisbonDay(new Date(game.comboAt)) !== lisbonDay(instant)) return 0;
    return num(game.combo);
  }

  function mergeGame(a, b, journey) {
    if (!isPlain(a) && !isPlain(b)) return null;
    var game = Object.assign({}, isPlain(a) ? a : {}, isPlain(b) ? b : {});
    game.xp = Math.max(num(isPlain(a) ? a.xp : 0), num(isPlain(b) ? b.xp : 0));

    var dateA = isPlain(a) && typeof a.lastGoalDate === "string" ? a.lastGoalDate : "";
    var dateB = isPlain(b) && typeof b.lastGoalDate === "string" ? b.lastGoalDate : "";
    var streakA = num(isPlain(a) ? a.streak : 0);
    var streakB = num(isPlain(b) ? b.streak : 0);
    if (dateB > dateA || (dateB === dateA && streakB > streakA)) {
      game.streak = streakB;
      game.lastGoalDate = dateB;
    } else {
      game.streak = streakA;
      game.lastGoalDate = dateA;
    }
    var fromDays = streakFromJourney(journey, new Date());
    if (fromDays > num(game.streak)) game.streak = fromDays;
    applyGoal(game, journey, new Date());

    var atA = num(isPlain(a) ? a.comboAt : 0);
    var atB = num(isPlain(b) ? b.comboAt : 0);
    if (atB > atA) {
      game.combo = num(b.combo);
      game.comboAt = atB;
    } else if (atA > atB) {
      game.combo = num(isPlain(a) ? a.combo : 0);
      game.comboAt = atA;
    } else {
      game.combo = Math.max(num(isPlain(a) ? a.combo : 0), num(isPlain(b) ? b.combo : 0));
      game.comboAt = atA;
    }
    game.bestCombo = Math.max(
      num(isPlain(a) ? a.bestCombo : 0),
      num(isPlain(b) ? b.bestCombo : 0),
      num(game.combo)
    );

    var celebA = isPlain(a) && typeof a.celebratedDate === "string" ? a.celebratedDate : "";
    var celebB = isPlain(b) && typeof b.celebratedDate === "string" ? b.celebratedDate : "";
    game.celebratedDate = celebA > celebB ? celebA : celebB;
    return game;
  }

  function cardsFromApp() {
    var app = global.App;
    return app && Array.isArray(app.cards) ? app.cards : [];
  }

  function snapshot(cards, now) {
    var instant = now instanceof Date ? now : new Date(now == null ? Date.now() : now);
    var game = loadGame() || {};
    var reviewed = reviewedToday(instant);
    var due = dueCount(cards == null ? cardsFromApp() : cards, instant.getTime());
    var left = remaining(due, reviewed);
    var xp = num(game.xp);
    var reason = "";
    if (left === 0) reason = reviewed >= GOAL ? "goal" : "clear";
    return {
      goal: GOAL,
      reviewedToday: reviewed,
      due: due,
      remaining: left,
      done: left === 0,
      doneReason: reason,
      xp: xp,
      level: levelFor(xp),
      streak: displayStreak(game, instant),
      combo: displayCombo(game, instant),
      xpPerCard: XP_PER_CARD,
    };
  }

  function streakLabel(streak) {
    if (!streak) return "🔥 Streak starts when you finish 20";
    if (streak === 1) return "🔥 1 day streak";
    return "🔥 " + streak + " day streak";
  }

  function leadFor(snap) {
    if (snap.doneReason === "goal") return "Today's 20 are done.";
    if (snap.doneReason === "clear") return "Nothing is due right now.";
    if (snap.remaining === 1) return "1 card left in today's 20.";
    return snap.remaining + " cards left in today's 20.";
  }

  function paintRing(reviewed) {
    var ring = document.getElementById("goal-ring");
    var value = document.getElementById("goal-ring-value");
    var count = document.getElementById("goal-count");
    var shown = reviewed > GOAL ? GOAL : reviewed;
    if (shown < 0) shown = 0;
    var offset = RING_CIRC * (1 - shown / GOAL);
    if (value) {
      value.style.strokeDasharray = String(RING_CIRC);
      value.style.strokeDashoffset = String(offset);
    }
    if (count) count.textContent = shown + "/" + GOAL;
    if (ring) {
      ring.classList.toggle("is-complete", reviewed >= GOAL);
      ring.setAttribute("aria-label", shown + " of " + GOAL + " cards reviewed today");
    }
  }

  function paint() {
    if (typeof document === "undefined") return snapshot();
    var stored = loadGame();
    var game = stored ? Object.assign({}, stored) : {};
    var before = JSON.stringify(game);
    noteGoal(game, new Date());
    if (JSON.stringify(game) !== before) saveGame(game);

    var snap = snapshot();
    paintRing(snap.reviewedToday);

    var xp = document.getElementById("study-hero-xp");
    if (xp) xp.textContent = "Level " + snap.level + " · " + snap.xp + " XP";

    var streak = document.getElementById("practice-streak");
    if (streak) streak.textContent = streakLabel(snap.streak);

    var lead = document.getElementById("study-lead");
    if (lead) lead.textContent = leadFor(snap);

    var meta = document.getElementById("study-start-meta");
    if (meta) meta.textContent = Math.min(snap.reviewedToday, GOAL) + "/" + GOAL + " today";

    var start = document.getElementById("study-start");
    if (start) {
      start.hidden = !!snap.done;
      start.setAttribute(
        "aria-label",
        snap.done ? "Practice complete" : "Start practice, " + snap.remaining + " cards"
      );
    }

    var done = document.getElementById("practice-done");
    if (done) {
      done.hidden = !snap.done;
      done.textContent = snap.doneReason === "goal"
        ? "Daily goal complete. 20/20."
        : "Nothing is due right now.";
    }

    var empty = document.getElementById("study-empty");
    if (empty && snap.done) empty.hidden = true;

    var combo = document.getElementById("practice-combo");
    if (combo) {
      if (snap.combo > 0) {
        combo.hidden = false;
        combo.textContent = "Combo ×" + snap.combo;
      } else {
        combo.hidden = true;
        combo.textContent = "";
      }
    }

    var bar = document.querySelector("#study-session .study-progress-bar");
    if (bar) {
      bar.setAttribute("aria-valuemax", String(GOAL));
      bar.setAttribute("aria-valuenow", String(Math.min(snap.reviewedToday, GOAL)));
      bar.setAttribute("aria-valuetext", Math.min(snap.reviewedToday, GOAL) + " of " + GOAL);
    }
    return snap;
  }

  var celebrateTimer = 0;

  function showCelebration() {
    if (typeof document === "undefined") return;
    var el = document.getElementById("practice-celebrate");
    if (!el) return;
    el.hidden = false;
    el.classList.remove("is-on");
    void el.offsetWidth;
    el.classList.add("is-on");
    if (celebrateTimer) clearTimeout(celebrateTimer);
    celebrateTimer = setTimeout(function () {
      celebrateTimer = 0;
      el.classList.remove("is-on");
      el.hidden = true;
    }, 2600);
  }

  function recordReview(rating, t) {
    var instant = typeof t === "number" && isFinite(t) ? t : Date.now();
    var safeRating = RATINGS[rating] ? rating : "good";
    var game = loadGame() || {};
    var today = lisbonDay(new Date(instant));
    var continuing = num(game.comboAt) &&
      lisbonDay(new Date(game.comboAt)) === today &&
      num(game.combo) > 0;
    if (safeRating === "again") game.combo = 0;
    else game.combo = continuing ? num(game.combo) + 1 : 1;
    game.comboAt = instant;
    if (num(game.combo) > num(game.bestCombo)) game.bestCombo = num(game.combo);
    game.xp = num(game.xp) + XP_PER_CARD;
    var justHit = noteGoal(game, new Date(instant));
    saveGame(game);
    return {
      justHit: justHit,
      xp: num(game.xp),
      gained: XP_PER_CARD,
      level: levelFor(game.xp),
      combo: displayCombo(game, new Date(instant)),
      streak: displayStreak(game, new Date(instant)),
      reviewedToday: reviewedToday(new Date(instant)),
    };
  }

  global.Daily = {
    GOAL: GOAL,
    XP_PER_CARD: XP_PER_CARD,
    GAME_KEY: GAME_KEY,
    lisbonDay: lisbonDay,
    shiftDay: shiftDay,
    dayStamp: dayStamp,
    reviewedTodayFrom: reviewedTodayFrom,
    reviewedToday: reviewedToday,
    streakFromJourney: streakFromJourney,
    remaining: remaining,
    levelFor: levelFor,
    dueCount: dueCount,
    displayStreak: displayStreak,
    displayCombo: displayCombo,
    mergeGame: mergeGame,
    loadGame: loadGame,
    snapshot: snapshot,
    paint: paint,
    recordReview: recordReview,
    showCelebration: showCelebration,
    noteGoal: noteGoal,
  };
})(typeof window !== "undefined" ? window : globalThis);
