/**
 * Shared audio playback for vocab cards.
 * Uses card.audio mp3 when present; falls back to speechSynthesis (zh-CN).
 */
(function (global) {
  "use strict";

  var player = null;
  var speaking = false;
  var playSeq = 0;

  function pickChineseVoice() {
    var synth = global.speechSynthesis;
    if (!synth || typeof synth.getVoices !== "function") return null;
    var voices = [];
    try {
      voices = synth.getVoices() || [];
    } catch (e) {
      return null;
    }
    var i;
    var lang;
    for (i = 0; i < voices.length; i++) {
      lang = String((voices[i] && voices[i].lang) || "").toLowerCase();
      if (lang === "zh-cn" || lang === "zh_cn") return voices[i];
    }
    for (i = 0; i < voices.length; i++) {
      lang = String((voices[i] && voices[i].lang) || "").toLowerCase();
      if (lang.indexOf("zh") === 0) return voices[i];
    }
    return null;
  }

  function stopPlayback() {
    if (player) {
      try {
        player.pause();
        player.currentTime = 0;
      } catch (e) {
        /* ignore */
      }
      player.onended = null;
      player.onerror = null;
      player = null;
    }
    if (global.speechSynthesis && typeof global.speechSynthesis.cancel === "function") {
      try {
        global.speechSynthesis.cancel();
      } catch (e) {
        /* ignore */
      }
    }
    speaking = false;
  }

  function stop() {
    playSeq += 1;
    stopPlayback();
  }

  function speakFallback(card, gen) {
    try {
      var synth = global.speechSynthesis;
      if (!synth || typeof synth.speak !== "function" || typeof SpeechSynthesisUtterance !== "function") {
        return false;
      }
      var text = (card && (card.hanzi || card.pinyin)) || "";
      if (!text) return false;
      var u = new SpeechSynthesisUtterance(text);
      var voice = pickChineseVoice();
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang || "zh-CN";
      } else {
        u.lang = "zh-CN";
      }
      u.rate = 0.9;
      u.onend = function () {
        if (gen === playSeq) speaking = false;
      };
      u.onerror = function () {
        if (gen === playSeq) speaking = false;
      };
      // Chrome drops speak() that runs in the same turn as cancel().
      var delay = typeof global.setTimeout === "function" ? global.setTimeout : setTimeout;
      delay(function () {
        if (gen !== playSeq || !global.speechSynthesis) return;
        try {
          speaking = true;
          global.speechSynthesis.speak(u);
        } catch (e) {
          speaking = false;
        }
      }, 40);
      return true;
    } catch (e) {
      speaking = false;
      return false;
    }
  }

  /**
   * @param {{audio?: string, hanzi?: string, pinyin?: string}} card
   * @returns {Promise<boolean>} true if playback started
   */
  function play(card) {
    if (!card) return Promise.resolve(false);
    var gen = ++playSeq;
    stopPlayback();

    var src = card.audio || "";
    if (!src) {
      return Promise.resolve(speakFallback(card, gen));
    }

    return new Promise(function (resolve) {
      var settled = false;
      function finish(value) {
        if (settled) return;
        settled = true;
        resolve(value);
      }
      var audio;
      try {
        audio = new Audio(src);
      } catch (e) {
        finish(speakFallback(card, gen));
        return;
      }
      player = audio;
      audio.preload = "auto";
      audio.onended = function () {
        if (player === audio) player = null;
      };
      audio.onerror = function () {
        if (gen !== playSeq) return finish(false);
        if (player === audio) player = null;
        finish(speakFallback(card, gen));
      };
      var started;
      try {
        started = audio.play();
      } catch (e) {
        if (player === audio) player = null;
        finish(gen === playSeq ? speakFallback(card, gen) : false);
        return;
      }
      if (started && typeof started.then === "function") {
        started.then(function () {
          finish(gen === playSeq);
        }).catch(function () {
          if (player === audio) player = null;
          finish(gen === playSeq ? speakFallback(card, gen) : false);
        });
      } else {
        finish(gen === playSeq);
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
