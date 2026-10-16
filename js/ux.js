/**
 * Fewer taps while studying.
 * Keyboard, swipe, resume, and optional audio — wired to the buttons already on the page.
 * Loaded before app.js so the address bar is still the link the user opened.
 */
(function (global) {
  "use strict";

  var KEY = "ml-ux-place-v1";
  var bootHash = global.location.hash || "";
  var reduceQuery = global.matchMedia("(prefers-reduced-motion: reduce)");
  var manualSpeak = false;
  var suppressAuto = false;
  var resumeLock = 0;
  var blockClick = false;
  var pointer = null;
  var bound = false;
  var holdList = false;

  function reduceMotion() {
    return !!(reduceQuery && reduceQuery.matches);
  }

  function load() {
    try {
      var data = JSON.parse(global.localStorage.getItem(KEY) || "null");
      return data && typeof data === "object" ? data : {};
    } catch (err) {
      return {};
    }
  }

  function write(data) {
    try {
      global.localStorage.setItem(KEY, JSON.stringify(data));
    } catch (err) {
      /* private mode */
    }
  }

  function session() {
    return global.Cards && global.Cards.session;
  }

  function autoplayOn() {
    var button = document.getElementById("ux-autoplay");
    if (button) return button.getAttribute("aria-pressed") !== "false";
    return load().autoplay !== false;
  }

  function practiceOpen() {
    var view = document.getElementById("view-study");
    return !!(view && !view.hidden && view.style.display !== "none");
  }

  function sessionOpen() {
    var node = document.getElementById("study-session");
    return practiceOpen() && !!(node && !node.hidden && node.style.display !== "none");
  }

  function dialogOpen() {
    var detail = document.getElementById("card-detail");
    var origin = document.getElementById("char-origin-overlay");
    if (detail && !detail.hidden) return true;
    if (origin && !origin.hidden) return true;
    return false;
  }

  function typing(target) {
    if (!target || !target.closest) return false;
    return !!target.closest("input, textarea, select, [contenteditable='true']");
  }

  function onControl(target) {
    if (!target || !target.closest) return false;
    var control = target.closest("button, a");
    if (!control || control.hidden) return false;
    if (control.getAttribute("aria-hidden") === "true") return false;
    if (control.offsetParent === null && control !== document.body) return false;
    return true;
  }

  function currentTab() {
    var active = document.querySelector(".tab-bar .tab.is-active");
    var name = active && active.getAttribute("data-tab");
    if (name === "library" || name === "progress" || name === "practice") return name;
    var hash = (global.location.hash || "").replace(/^#/, "");
    if (hash === "library" || hash === "progress") return hash;
    return "practice";
  }

  function searchValue() {
    var input = document.getElementById("search-input");
    return input ? input.value : "";
  }

  function deckValue() {
    var select = document.getElementById("study-keyword");
    return select ? select.value : "";
  }

  function visibleList() {
    var view = document.getElementById("view-library");
    if (!view || view.hidden) return null;
    var rows = document.querySelectorAll("#card-list .list-row");
    if (!rows.length) return null;
    var best = 0;
    var bestTop = Infinity;
    for (var i = 0; i < rows.length; i++) {
      var rect = rows[i].getBoundingClientRect();
      if (rect.bottom > 64 && rect.top < bestTop) {
        bestTop = rect.top;
        best = i;
      }
    }
    return { index: best, id: rows[best].getAttribute("data-id") || "" };
  }

  function snapshot() {
    var prev = load();
    var data = {
      v: 1,
      tab: currentTab() || prev.tab || "practice",
      search: searchValue(),
      deck: prev.queueIds && prev.queueIds.length ? prev.deck || "" : deckValue() || prev.deck || "",
      autoplay: autoplayOn(),
      index: prev.index || 0,
      cardId: prev.cardId || "",
      queueIds: prev.queueIds || [],
      flipped: !!prev.flipped,
      active: false,
      listIndex: prev.listIndex || 0,
      listId: prev.listId || "",
    };
    var live = session();
    if (live && live.active && live.queue && live.queue.length) {
      data.active = true;
      data.index = live.index || 0;
      data.flipped = !!live.flipped;
      data.queueIds = live.queue.map(function (card) {
        return card.id;
      });
      var card = live.queue[live.index];
      data.cardId = (card && card.id) || "";
      if (live.filter) data.deck = live.filter.keyword || "";
    }
    var list = holdList ? null : visibleList();
    if (list) {
      data.listIndex = list.index;
      data.listId = list.id;
    }
    return data;
  }

  function save(extra) {
    if (resumeLock) return;
    var data = snapshot();
    if (extra) {
      Object.keys(extra).forEach(function (key) {
        data[key] = extra[key];
      });
    }
    write(data);
    paintContinue();
  }

  function installAudioGate() {
    var audio = global.VocabAudio;
    if (!audio || audio.__uxGate || typeof audio.play !== "function") return;
    var play = audio.play;
    audio.play = function (card) {
      if (suppressAuto) return Promise.resolve(false);
      var manual = manualSpeak;
      manualSpeak = false;
      if (!manual) {
        var live = session();
        if (live && live.flipped && !autoplayOn()) return Promise.resolve(false);
      }
      return play.call(audio, card);
    };
    audio.__uxGate = true;
  }

  function setShown(id, on) {
    var node = document.getElementById(id);
    if (!node) return;
    node.hidden = !on;
    node.style.display = on ? "" : "none";
  }

  function optionExists(select, value) {
    if (!select) return false;
    for (var i = 0; i < select.options.length; i++) {
      if (select.options[i].value === value) return true;
    }
    return false;
  }

  function showSession() {
    setShown("study-idle", false);
    setShown("study-empty", false);
    setShown("practice-done", false);
    setShown("study-session", true);
  }

  function goalRoom() {
    var goal = global.Daily && global.Daily.GOAL ? global.Daily.GOAL : 20;
    var reviewed = 0;
    if (global.Daily && typeof global.Daily.reviewedToday === "function") {
      reviewed = global.Daily.reviewedToday();
    }
    if (typeof reviewed !== "number" || !isFinite(reviewed) || reviewed < 0) reviewed = 0;
    var room = goal - reviewed;
    return room > 0 ? room : 0;
  }

  function resumeSession(data) {
    data = data || load();
    if (!data.queueIds || !data.queueIds.length) return false;
    if (!global.Cards || typeof global.Cards.renderCard !== "function" || !session()) return false;
    if (goalRoom() <= 0) {
      paintContinue();
      return false;
    }
    resumeLock += 1;
    suppressAuto = true;
    try {
      var select = document.getElementById("study-keyword");
      if (select && data.deck != null && optionExists(select, data.deck)) select.value = data.deck;
      var start = document.getElementById("study-start");
      if (start) start.click();
      var live = session();
      if (!live) return false;
      var cards = (global.App && global.App.cards) || [];
      var byId = {};
      for (var i = 0; i < cards.length; i++) byId[cards[i].id] = cards[i];
      var queue = [];
      for (var j = 0; j < data.queueIds.length; j++) {
        if (byId[data.queueIds[j]]) queue.push(byId[data.queueIds[j]]);
      }
      if (!queue.length) return false;
      var idx = data.index || 0;
      if (data.cardId) {
        for (var k = 0; k < queue.length; k++) {
          if (queue[k].id === data.cardId) {
            idx = k;
            break;
          }
        }
      }
      if (idx < 0) idx = 0;
      if (idx >= queue.length) idx = queue.length - 1;
      var room = goalRoom();
      if (room <= 0) return false;
      if (queue.length - idx > room) queue = queue.slice(0, idx + room);
      if (!queue.length || idx >= queue.length) return false;
      live.queue = queue;
      live.active = true;
      live.starting = false;
      live.locked = false;
      live.revealAfter = 0;
      live.filter = { keyword: data.deck || undefined };
      live.index = idx;
      live.flipped = !!data.flipped;
      showSession();
      if (global.Cards && typeof global.Cards.enterPracticeFocus === "function") {
        global.Cards.enterPracticeFocus();
      }
      if (global.VocabAudio && global.VocabAudio.stop) global.VocabAudio.stop();
      global.Cards.renderCard();
      if (live.flipped && autoplayOn() && global.VocabAudio) {
        manualSpeak = false;
        global.VocabAudio.play(live.queue[live.index]);
      }
      return true;
    } finally {
      suppressAuto = false;
      resumeLock -= 1;
      save();
    }
  }

  function restoreList(data) {
    var rows = document.querySelectorAll("#card-list .list-row");
    if (!rows.length || !data) return;
    var row = null;
    if (data.listId) {
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].getAttribute("data-id") === data.listId) {
          row = rows[i];
          break;
        }
      }
    }
    if (!row && data.listIndex != null) row = rows[data.listIndex] || null;
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: reduceMotion() ? "auto" : "smooth" });
  }

  function explicitHash() {
    var hash = bootHash || "";
    return (
      hash === "#library" ||
      hash === "#progress" ||
      hash === "#practice" ||
      hash === "#study" ||
      hash.indexOf("#word/") === 0
    );
  }

  function resumeOnOpen() {
    var data = load();
    resumeLock += 1;
    try {
      if (!explicitHash() && data.tab && data.tab !== currentTab()) {
        var tab = document.querySelector('.tab-bar .tab[data-tab="' + data.tab + '"]');
        if (tab) tab.click();
      }
      if (bootHash.indexOf("#word/") !== 0 && data.search) {
        var input = document.getElementById("search-input");
        if (input && input.value !== data.search) {
          input.value = data.search;
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
      var select = document.getElementById("study-keyword");
      if (select && data.deck != null && optionExists(select, data.deck)) select.value = data.deck;
      syncToggle(data.autoplay !== false);
    } finally {
      resumeLock -= 1;
    }

    var practice =
      currentTab() === "practice" &&
      bootHash.indexOf("#word/") !== 0 &&
      bootHash !== "#library" &&
      bootHash !== "#progress";
    if (data.active && practice) resumeSession(data);

    var place = load();
    holdList = true;
    global.setTimeout(function () {
      restoreList(place);
      holdList = false;
      paintContinue();
    }, 450);
  }

  function deckLabel(deck) {
    return deck ? deck : "All topics";
  }

  function paintContinue() {
    var button = document.getElementById("ux-continue");
    if (!button) return;
    var data = load();
    var live = session();
    var busy = !!(live && live.active && sessionOpen());
    var hasPlace = !!((data.queueIds && data.queueIds.length) || data.cardId);
    if (!hasPlace || busy || goalRoom() <= 0) {
      button.hidden = true;
      return;
    }
    button.hidden = false;
    var small = button.querySelector("small");
    var n = (data.index || 0) + 1;
    var total = (data.queueIds && data.queueIds.length) || 0;
    var where = deckLabel(data.deck) + " · card " + n + (total ? " of " + total : "");
    if (small) small.textContent = where;
    button.setAttribute("aria-label", "Continue where I left off, " + where);
  }

  function syncToggle(on) {
    var button = document.getElementById("ux-autoplay");
    if (!button) return;
    button.setAttribute("aria-pressed", on ? "true" : "false");
    var state = button.querySelector(".ux-toggle-state");
    if (state) state.textContent = on ? "On" : "Off";
  }

  function annotateKeys() {
    var map = [
      ["btn-again", "1 ←", "1 ArrowLeft"],
      ["btn-hard", "2 ↓", "2 ArrowDown"],
      ["btn-good", "3 ↑", "3 ArrowUp"],
      ["btn-easy", "4 →", "4 ArrowRight"],
    ];
    for (var i = 0; i < map.length; i++) {
      var button = document.getElementById(map[i][0]);
      if (!button) continue;
      var key = button.querySelector(".rate-key");
      if (key && !key.getAttribute("data-ux")) {
        key.setAttribute("data-ux", "1");
        key.textContent = map[i][1];
      }
      if (!button.getAttribute("aria-keyshortcuts")) {
        button.setAttribute("aria-keyshortcuts", map[i][2]);
      }
    }
    var reveal = document.getElementById("btn-reveal");
    if (reveal && !reveal.getAttribute("aria-keyshortcuts")) {
      reveal.setAttribute("aria-keyshortcuts", "Space Enter ArrowUp");
    }
  }

  function mount() {
    var view = document.getElementById("view-study");
    if (view && !document.getElementById("ux-autoplay")) {
      var bar = document.createElement("div");
      bar.id = "ux-bar";
      bar.className = "ux-bar";
      var toggle = document.createElement("button");
      toggle.type = "button";
      toggle.id = "ux-autoplay";
      toggle.className = "ux-toggle";
      toggle.setAttribute("aria-pressed", "true");
      var label = document.createElement("span");
      label.textContent = "Audio after reveal";
      var state = document.createElement("span");
      state.className = "ux-toggle-state";
      state.textContent = "On";
      toggle.append(label, state);
      bar.appendChild(toggle);
      view.insertBefore(bar, view.firstChild);
      toggle.addEventListener("click", function () {
        syncToggle(!autoplayOn());
        save();
      });
    }

    var idle = document.getElementById("study-idle");
    var start = document.getElementById("study-start");
    if (idle && !document.getElementById("ux-continue")) {
      var cont = document.createElement("button");
      cont.type = "button";
      cont.id = "ux-continue";
      cont.className = "ux-continue";
      cont.hidden = true;
      var text = document.createElement("span");
      var small = document.createElement("small");
      var strong = document.createElement("strong");
      strong.textContent = "Continue where I left off";
      text.append(small, strong);
      var go = document.createElement("span");
      go.className = "ux-continue-go";
      go.setAttribute("aria-hidden", "true");
      go.textContent = "→";
      cont.append(text, go);
      if (start) idle.insertBefore(cont, start);
      else idle.appendChild(cont);
      cont.addEventListener("click", function () {
        resumeSession(load());
      });
    }

    var card = document.getElementById("flashcard");
    if (card && !card.querySelector(".ux-swipe-label")) {
      var swipe = document.createElement("div");
      swipe.className = "ux-swipe-label";
      swipe.setAttribute("aria-hidden", "true");
      card.appendChild(swipe);
    }

    var study = document.getElementById("study-session");
    if (study && !document.getElementById("ux-keys")) {
      var keys = document.createElement("p");
      keys.id = "ux-keys";
      keys.className = "ux-keys";
      keys.textContent = "Space or Enter reveals. Arrows move, then grade. 1–4 grade. S speaks. Swipe up to reveal.";
      study.appendChild(keys);
    }

    syncToggle(load().autoplay !== false);
    annotateKeys();
    paintContinue();
  }

  function reveal() {
    var live = session();
    if (live && live.flipped) return false;
    var button = document.getElementById("btn-reveal");
    if (button && !button.hidden && button.style.display !== "none") {
      button.click();
      return true;
    }
    var card = document.getElementById("flashcard");
    if (card) {
      card.click();
      return true;
    }
    return false;
  }

  function grade(id) {
    var wrap = document.getElementById("study-actions");
    if (!wrap || wrap.hidden || wrap.style.display === "none") return false;
    var button = document.getElementById(id);
    if (!button || button.disabled || button.hidden) return false;
    button.click();
    return true;
  }

  function step(delta) {
    var live = session();
    if (!live || !live.active || !live.queue || live.queue.length < 2) return false;
    if (typeof global.Cards.renderCard !== "function") return false;
    if (typeof live.index !== "number" || live.index < 0 || live.index >= live.queue.length) return false;
    if (live.queue.length - live.index < 2) return false;
    if (delta > 0) live.queue.push(live.queue.splice(live.index, 1)[0]);
    else if (delta < 0) live.queue.splice(live.index, 0, live.queue.pop());
    else return false;
    live.flipped = false;
    live.locked = false;
    live.revealAfter = 0;
    if (global.VocabAudio && global.VocabAudio.stop) global.VocabAudio.stop();
    global.Cards.renderCard();
    save();
    return true;
  }

  function speak() {
    var button = document.querySelector("#flashcard [data-audio-btn], #detail-body [data-audio-btn]");
    if (button) {
      button.click();
      return true;
    }
    var live = session();
    var card = live && live.queue && live.queue[live.index];
    if (!card || !global.VocabAudio) return false;
    manualSpeak = true;
    global.VocabAudio.play(card);
    return true;
  }

  function faceUp() {
    var live = session();
    return !!(live && live.flipped);
  }

  function onKey(event) {
    if (event.defaultPrevented) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    if (!sessionOpen() || dialogOpen() || typing(event.target)) return;
    if (event.repeat) return;

    var key = event.key;
    var acted = false;

    if ((key === " " || event.code === "Space" || key === "Enter") && !onControl(event.target)) {
      acted = !faceUp() ? reveal() : false;
      if (key === " " || event.code === "Space") acted = true;
    } else if (key === "1" || (faceUp() && key === "ArrowLeft")) {
      acted = grade("btn-again");
    } else if (key === "2" || (faceUp() && key === "ArrowDown")) {
      acted = grade("btn-hard");
    } else if (key === "3" || (faceUp() && key === "ArrowUp")) {
      acted = grade("btn-good");
    } else if (key === "4" || (faceUp() && key === "ArrowRight")) {
      acted = grade("btn-easy");
    } else if (!faceUp() && key === "ArrowLeft") {
      acted = step(-1);
    } else if (!faceUp() && key === "ArrowRight") {
      acted = step(1);
    } else if (!faceUp() && key === "ArrowUp") {
      acted = reveal();
    } else if (key === "s" || key === "S") {
      acted = speak();
    }

    if (!acted) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function swipeLabel(text, kind) {
    var card = document.getElementById("flashcard");
    if (!card) return;
    var label = card.querySelector(".ux-swipe-label");
    if (!label) return;
    label.textContent = text;
    label.className = "ux-swipe-label is-on" + (kind ? " " + kind : "");
  }

  function clearDrag() {
    var card = document.getElementById("flashcard");
    if (!card) return;
    card.classList.remove("ux-dragging", "ux-left", "ux-right", "ux-up");
    if (reduceMotion()) {
      card.style.transform = "";
    } else {
      card.style.transition = "transform 0.18s var(--ease-out, ease)";
      card.style.transform = "";
      global.setTimeout(function () {
        card.style.transition = "";
      }, 200);
    }
    var label = card.querySelector(".ux-swipe-label");
    if (label) {
      label.className = "ux-swipe-label";
      label.textContent = "";
    }
  }

  function scrollSnapshot() {
    var nodes = [
      document.scrollingElement,
      document.getElementById("view-study"),
      document.getElementById("view-root"),
    ];
    var saved = [];
    for (var i = 0; i < nodes.length; i++) {
      if (!nodes[i]) continue;
      saved.push({ node: nodes[i], top: nodes[i].scrollTop, left: nodes[i].scrollLeft });
    }
    return saved;
  }

  function restoreScroll(saved) {
    if (!saved) return;
    for (var i = 0; i < saved.length; i++) {
      saved[i].node.scrollTop = saved[i].top;
      saved[i].node.scrollLeft = saved[i].left;
    }
  }

  function applyDrag(dx, dy) {
    var card = document.getElementById("flashcard");
    if (!card) return;
    card.classList.add("ux-dragging");
    card.classList.remove("ux-left", "ux-right", "ux-up");
    var up = faceUp();
    if (Math.abs(dy) > Math.abs(dx) && dy < 0) {
      card.classList.add("ux-up");
      swipeLabel("Reveal", "is-reveal");
    } else if (dx < 0) {
      card.classList.add("ux-left");
      swipeLabel(up ? "Again" : "Previous", up ? "is-again" : "is-move");
    } else {
      card.classList.add("ux-right");
      swipeLabel(up ? "Good" : "Next", up ? "is-good" : "is-move");
    }
    if (!reduceMotion()) {
      var x = Math.max(-72, Math.min(72, dx));
      var y = Math.max(-64, Math.min(24, dy));
      card.style.transform = "translate3d(" + x + "px," + y + "px,0)";
    }
  }

  function finishSwipe(dx, dy) {
    var distanceX = Math.abs(dx);
    var distanceY = Math.abs(dy);
    if (distanceX < 12 && distanceY < 12) return false;
    blockClick = true;
    if (distanceY > distanceX && dy < -48) {
      reveal();
      return true;
    }
    if (distanceX > distanceY && distanceX > 48) {
      if (dx < 0) {
        if (faceUp()) grade("btn-again");
        else step(-1);
      } else if (faceUp()) {
        grade("btn-good");
      } else {
        step(1);
      }
      return true;
    }
    return true;
  }

  function onPointerDown(event) {
    blockClick = false;
    if (pointer) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    var card = event.currentTarget;
    if (!card) return;
    if (event.target.closest("input, select, textarea, .flashcard-origins, [data-origin-toggle], [data-mark-known]")) return;
    pointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      dx: 0,
      dy: 0,
      claimed: false,
      scroll: false,
      scrollPos: scrollSnapshot(),
    };
  }

  function onPointerMove(event) {
    if (!pointer || event.pointerId !== pointer.id) return;
    pointer.dx = event.clientX - pointer.x;
    pointer.dy = event.clientY - pointer.y;
    var distanceX = Math.abs(pointer.dx);
    var distanceY = Math.abs(pointer.dy);
    if (!pointer.claimed && !pointer.scroll) {
      if (distanceX < 8 && distanceY < 8) return;
      if (distanceY > distanceX && pointer.dy > 0) {
        pointer.scroll = true;
        return;
      }
      pointer.claimed = true;
      var card = document.getElementById("flashcard");
      if (card && card.setPointerCapture) {
        try {
          card.setPointerCapture(event.pointerId);
        } catch (err) {
          /* already released */
        }
      }
    }
    if (!pointer.claimed || pointer.scroll) return;
    restoreScroll(pointer.scrollPos);
    applyDrag(pointer.dx, pointer.dy);
  }

  function endPointer(event, act) {
    if (!pointer || event.pointerId !== pointer.id) return;
    var dx = pointer.dx;
    var dy = pointer.dy;
    var claimed = pointer.claimed;
    var saved = pointer.scrollPos;
    pointer = null;
    clearDrag();
    if (!act || !claimed) return;
    restoreScroll(saved);
    finishSwipe(dx, dy);
  }

  function onPointerUp(event) {
    endPointer(event, true);
  }

  function onPointerCancel(event) {
    endPointer(event, false);
  }

  function onTouchMove(event) {
    if (!pointer || !pointer.claimed) return;
    if (event.cancelable) event.preventDefault();
    restoreScroll(pointer.scrollPos);
  }

  function bindCard() {
    var card = document.getElementById("flashcard");
    if (!card || card.getAttribute("data-ux-swipe")) return;
    card.setAttribute("data-ux-swipe", "1");
    card.addEventListener("pointerdown", onPointerDown);
    card.addEventListener("pointermove", onPointerMove);
    card.addEventListener("pointerup", onPointerUp);
    card.addEventListener("pointercancel", onPointerCancel);
    card.addEventListener("touchmove", onTouchMove, { passive: false });
  }

  function bind() {
    if (bound) return;
    bound = true;
    installAudioGate();
    mount();
    bindCard();

    document.addEventListener("keydown", onKey, true);

    document.addEventListener(
      "click",
      function (event) {
        if (event.target.closest("[data-audio-btn]")) manualSpeak = true;
        var gradeBtn = event.target.closest("#btn-again, #btn-hard, #btn-good, #btn-easy");
        if (!gradeBtn) return;
        var live = session();
        if (!live || !live.queue || !live.queue.length) return;
        var next = live.index + 1;
        if (next >= live.queue.length) {
          save({ active: false, flipped: false, index: 0, cardId: "", queueIds: [] });
          resumeLock += 1;
          global.setTimeout(function () {
            resumeLock -= 1;
            paintContinue();
          }, 0);
          return;
        }
        save({
          active: true,
          flipped: false,
          index: next,
          cardId: live.queue[next].id,
        });
      },
      true
    );

    document.addEventListener(
      "click",
      function (event) {
        if (!blockClick) return;
        if (!event.target.closest("#flashcard")) return;
        event.preventDefault();
        event.stopPropagation();
        blockClick = false;
      },
      true
    );

    document.addEventListener("click", function (event) {
      if (event.target.closest("#btn-again, #btn-hard, #btn-good, #btn-easy, #btn-reveal, #study-start, #ux-continue, .tab-bar .tab")) {
        global.setTimeout(function () {
          save();
          var card = document.getElementById("flashcard");
          if (card && sessionOpen() && event.target.closest("#study-start, #ux-continue")) card.focus();
        }, 0);
      }
    });

    var search = document.getElementById("search-input");
    if (search) {
      var searchTimer = 0;
      search.addEventListener("input", function () {
        global.clearTimeout(searchTimer);
        searchTimer = global.setTimeout(function () {
          save();
        }, 160);
      });
    }

    var select = document.getElementById("study-keyword");
    if (select) {
      select.addEventListener("change", function () {
        var prev = load();
        if (prev.queueIds && prev.queueIds.length) return;
        save({ deck: select.value });
      });
    }

    var scrollTimer = 0;
    document.addEventListener(
      "scroll",
      function () {
        global.clearTimeout(scrollTimer);
        scrollTimer = global.setTimeout(function () {
          save();
        }, 180);
      },
      true
    );

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") save();
    });
    global.addEventListener("pagehide", function () {
      save();
    });

    var idle = document.getElementById("study-idle");
    if (idle && global.MutationObserver) {
      new MutationObserver(function () {
        paintContinue();
      }).observe(idle, { attributes: true, attributeFilter: ["hidden", "style"] });
    }

    document.addEventListener("ml-library-ready", function () {
      installAudioGate();
      annotateKeys();
      bindCard();
      resumeOnOpen();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }

  global.StudyUx = {
    resume: function () {
      return resumeSession(load());
    },
    save: save,
  };
})(typeof window !== "undefined" ? window : globalThis);
