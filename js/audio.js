/**
 * Shared audio playback for vocab cards.
 * Uses card.audio mp3 when present; falls back to speechSynthesis (zh-CN).
 */
(function (global) {
  "use strict";

  var player = null;
  var speaking = false;

  function stop() {
    if (player) {
      try {
        player.pause();
        player.currentTime = 0;
      } catch (e) {
        /* ignore */
      }
      player = null;
    }
    if (global.speechSynthesis) {
      global.speechSynthesis.cancel();
    }
    speaking = false;
  }

  function speakFallback(card) {
    if (!global.speechSynthesis) return false;
    var text = (card && (card.hanzi || card.pinyin)) || "";
    if (!text) return false;
    stop();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    u.rate = 0.9;
    speaking = true;
    u.onend = function () {
      speaking = false;
    };
    u.onerror = function () {
      speaking = false;
    };
    global.speechSynthesis.speak(u);
    return true;
  }

  /**
   * @param {{audio?: string, hanzi?: string, pinyin?: string}} card
   * @returns {Promise<boolean>} true if playback started
   */
  function play(card) {
    if (!card) return Promise.resolve(false);
    stop();

    var src = card.audio || "";
    if (!src) {
      return Promise.resolve(speakFallback(card));
    }

    return new Promise(function (resolve) {
      player = new Audio(src);
      player.preload = "auto";
      player.onended = function () {
        player = null;
      };
      player.onerror = function () {
        player = null;
        resolve(speakFallback(card));
      };
      var p = player.play();
      if (p && typeof p.then === "function") {
        p.then(function () {
          resolve(true);
        }).catch(function () {
          resolve(speakFallback(card));
        });
      } else {
        resolve(true);
      }
    });
  }

  function isPlaying() {
    if (player && !player.paused && !player.ended) return true;
    return speaking;
  }

  global.VocabAudio = {
    play: play,
    stop: stop,
    isPlaying: isPlaying,
  };
})(typeof window !== "undefined" ? window : globalThis);
