const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");

function storage(seed) {
  const map = new Map(Object.entries(seed || {}));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
  };
}

function loadScripts(files, extra) {
  const ctx = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    URL,
    URLSearchParams,
    btoa,
    atob,
    TextEncoder,
    TextDecoder,
    Intl,
    Date,
    Math,
    JSON,
    Object,
    Array,
    String,
    Number,
    Error,
    TypeError,
    Promise,
    Map,
    Set,
    RegExp,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    escape,
    unescape,
    AbortController,
    localStorage: storage(),
    addEventListener() {},
    removeEventListener() {},
    fetch() {
      return Promise.reject(new TypeError("Failed to fetch"));
    },
    confirm() {
      return true;
    },
    prompt() {
      return "";
    },
  };
  Object.assign(ctx, extra || {});
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const file of files) {
    const code = fs.readFileSync(path.join(root, file), "utf8");
    vm.runInContext(code, ctx, { filename: file });
  }
  return ctx;
}

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json() {
      return Promise.resolve(body);
    },
  };
}

function decodePut(body) {
  const parsed = JSON.parse(body);
  const json = Buffer.from(parsed.content, "base64").toString("utf8");
  return { sha: parsed.sha, message: parsed.message, data: JSON.parse(json) };
}

test("pinyin tone marks, umlauts, and neutral digits", () => {
  const ctx = loadScripts(["js/cards.js"]);
  const format = ctx.Pinyin.format;
  const fold = ctx.Pinyin.fold;
  assert.equal(format("ni3"), "nǐ");
  assert.equal(format("hao3"), "hǎo");
  assert.equal(format("Ni3 hao3"), "Nǐ hǎo");
  assert.equal(format("hui4"), "huì");
  assert.equal(format("liu2"), "liú");
  assert.equal(format("shui3"), "shuǐ");
  assert.equal(format("lv4"), "lǜ");
  assert.equal(format("lve4"), "lüè");
  assert.equal(format("nu:3"), "nǚ");
  assert.equal(format("xve2"), "xué");
  assert.equal(format("yv3"), "yǔ");
  assert.equal(format("Er2"), "Ér");
  assert.equal(format("ma5"), "ma");
  assert.equal(format("nǐ"), "nǐ");
  assert.equal(format("12 yuè 13"), "12 yuè 13");
  assert.equal(fold("ni3"), fold("nǐ"));
  assert.equal(fold("nv"), fold("nǚ"));
  assert.equal(fold("nve4"), fold("nüè"));
  assert.equal(fold("envy").includes(fold("envy")), true);

  const card = {
    hanzi: "頂尖",
    pinyin: "Dǐng jiān",
    gloss: "top-notch; pinnacle",
    pos: "adjective",
    keywords: ["adjective", "learning", "notch", "pinnacle", "top"],
  };
  const ni = {
    hanzi: "年",
    pinyin: "nián",
    gloss: "year",
    pos: "noun",
    keywords: ["learning", "year"],
  };
  const nine = { hanzi: "九", pinyin: "jiǔ", gloss: "nine", pos: "numeral", keywords: ["known"] };
  assert.equal(ctx.Pinyin.matches("nǐ", card), false);
  assert.equal(ctx.Pinyin.matches("ni3", card), false);
  assert.equal(ctx.Pinyin.matches("learning", card), false);
  assert.equal(ctx.Pinyin.matches("nǐ", ni), true);
  assert.equal(ctx.Pinyin.matches("ni3", ni), true);
  assert.equal(ctx.Pinyin.matches("nian", ni), true);
  assert.equal(ctx.Pinyin.matches("nine", nine), true);
  assert.equal(ctx.Pinyin.matches("你", { hanzi: "你好", pinyin: "nǐ hǎo", gloss: "hello" }), true);
  assert.equal(ctx.Pinyin.matches("ni hao", { hanzi: "你好", pinyin: "nǐ hǎo", gloss: "hello" }), true);
  assert.equal(ctx.Pinyin.matches("time", { hanzi: "时", pinyin: "shí", gloss: "time", keywords: ["time"] }), true);
});

test("corrupt SRS storage is repaired and later reviews are kept", () => {
  const ctx = loadScripts(["js/srs.js"]);
  ctx.localStorage.setItem("ml-chinese-srs-v1", "{not json");
  const due = ctx.SRS.dueCards(["a", "b"]);
  assert.equal(Array.from(due).join(","), "a,b");
  ctx.SRS.review("a", "good");
  ctx.SRS.review("b", "again");
  const saved = JSON.parse(ctx.localStorage.getItem("ml-chinese-srs-v1"));
  assert.equal(typeof saved.a.due, "number");
  assert.equal(saved.b.lapses, 1);
  ctx.localStorage.setItem("ml-chinese-srs-v1", "[1,2,3]");
  ctx.SRS.review("c", "easy");
  const again = JSON.parse(ctx.localStorage.getItem("ml-chinese-srs-v1"));
  assert.equal(Array.isArray(again), false);
  assert.equal(typeof again.c.interval, "number");
});

test("corrupt status and journey storage do not throw or stay arrays", () => {
  const ctx = loadScripts(["js/status.js", "js/journey.js", "js/daily.js"]);
  ctx.localStorage.setItem("ml-chinese-status-v1", "[1,2,3]");
  ctx.StatusStore.setStatus("card-1", "known");
  const status = JSON.parse(ctx.localStorage.getItem("ml-chinese-status-v1"));
  assert.equal(Array.isArray(status), false);
  assert.equal(status["card-1"], "known");

  ctx.localStorage.setItem("ml-chinese-journey-v1", "null");
  assert.doesNotThrow(() => ctx.JourneyStore.logStudy(1));
  const journey = JSON.parse(ctx.localStorage.getItem("ml-chinese-journey-v1"));
  assert.equal(Array.isArray(journey.events), true);
  assert.equal(journey.events[0].type, "study");

  ctx.localStorage.setItem("ml-chinese-journey-v1", JSON.stringify([1, 2]));
  assert.doesNotThrow(() => ctx.JourneyStore.logStudy(2));
  const healed = ctx.JourneyStore.load();
  assert.equal(Array.isArray(healed.firstKnown), false);

  ctx.localStorage.setItem("ml-chinese-game-v1", "\"bad\"");
  const reviewed = ctx.Daily.recordReview("good", Date.now());
  assert.equal(reviewed.gained, 10);
  assert.equal(typeof JSON.parse(ctx.localStorage.getItem("ml-chinese-game-v1")).xp, "number");
});

test("merge keeps a real SRS card when the other copy is corrupt", () => {
  const ctx = loadScripts(["js/daily.js", "js/backup.js"]);
  const good = { ease: 2.5, interval: 3, repetitions: 2, due: 10, lapses: 0, last: 5 };
  const merged = ctx.ChineseBackup.merge(
    { status: ["nope"], srs: { a: good }, journey: null },
    { status: { b: "known" }, srs: { a: 4, c: { ease: 2, interval: 1, repetitions: 1, due: 9, lapses: 0, last: 9 } }, journey: { snapshots: [], events: [], firstKnown: {} } }
  );
  assert.equal(merged.status.b, "known");
  assert.equal(merged.srs.a, good);
  assert.equal(merged.srs.c.last, 9);
  assert.equal(Array.isArray(merged.status), false);
});

test("gh-sync load and save treat an empty file as nothing saved", async () => {
  const puts = [];
  const ctx = loadScripts(["dong-ui/gh-sync.js"], {
    confirm() {
      return true;
    },
    fetch(url, opts) {
      const method = (opts && opts.method) || "GET";
      if (method === "GET") {
        return Promise.resolve(jsonResponse(200, { sha: "empty-sha", content: "\n", encoding: "base64" }));
      }
      puts.push(decodePut(opts.body));
      return Promise.resolve(jsonResponse(200, { content: { sha: "after" } }));
    },
  });
  ctx.localStorage.setItem("dong-gh-sync", JSON.stringify({ token: "t", repo: "Dong-Xuyong/progress-sync" }));
  let applied = false;
  const loaded = await ctx.GhSync.load("chinese-library", () => {
    applied = true;
  });
  assert.equal(loaded, "Nothing saved on GitHub yet");
  assert.equal(applied, false);

  const saved = await ctx.GhSync.save(
    "chinese-library",
    () => ({ app: "chinese-library", version: 1, status: { a: "known" } }),
    () => {}
  );
  assert.equal(saved, "Saved to GitHub");
  assert.equal(puts.length, 1);
  assert.equal(puts[0].sha, "empty-sha");
  assert.equal(puts[0].data.status.a, "known");
});

test("gh-sync save retries a 409 once and a second click does not double-submit", async () => {
  let puts = 0;
  let gets = 0;
  let confirms = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const ctx = loadScripts(["dong-ui/gh-sync.js"], {
    confirm() {
      confirms += 1;
      return true;
    },
    fetch(url, opts) {
      const method = (opts && opts.method) || "GET";
      if (method === "GET") {
        gets += 1;
        const sha = gets === 1 ? "sha-old" : "sha-new";
        const content = Buffer.from(JSON.stringify({ app: "chinese-library", status: { remote: "learning" } }), "utf8").toString("base64");
        return Promise.resolve(jsonResponse(200, { sha, content, encoding: "base64" }));
      }
      puts += 1;
      if (puts === 1) return Promise.resolve(jsonResponse(409, { message: "conflict" }));
      const decoded = decodePut(opts.body);
      assert.equal(decoded.sha, "sha-new");
      return gate.then(() => jsonResponse(200, { content: { sha: "sha-written" } }));
    },
  });
  ctx.localStorage.setItem("dong-gh-sync", JSON.stringify({ token: "t", repo: "Dong-Xuyong/progress-sync" }));
  const payload = () => ({ app: "chinese-library", version: 1, status: { local: "known" } });
  const first = ctx.GhSync.save("chinese-library", payload, () => {});
  const second = ctx.GhSync.save("chinese-library", payload, () => {});
  assert.equal(first, second);
  assert.equal(confirms, 2);
  release();
  assert.equal(await first, "Saved to GitHub");
  assert.equal(puts, 2);
  assert.ok(gets >= 2);
});

test("gh-sync offline save and load reject without an unhandled failure", async () => {
  const ctx = loadScripts(["dong-ui/gh-sync.js"], {
    confirm() {
      return true;
    },
    fetch() {
      return Promise.reject(new TypeError("Failed to fetch"));
    },
  });
  ctx.localStorage.setItem("dong-gh-sync", JSON.stringify({ token: "t", repo: "Dong-Xuyong/progress-sync" }));
  await assert.rejects(
    () => ctx.GhSync.load("chinese-library", () => {}),
    (err) => /could not reach github/i.test(err.message)
  );
  await assert.rejects(
    () => ctx.GhSync.save("chinese-library", () => ({ app: "chinese-library" }), () => {}),
    (err) => /could not reach github/i.test(err.message)
  );
});

test("audio survives a missing zh-CN voice and rapid taps", async () => {
  const speaks = [];
  const ctx = loadScripts(["js/audio.js"], {
    speechSynthesis: {
      cancel() {},
      getVoices() {
        return [{ lang: "en-US", name: "English" }];
      },
      speak(utterance) {
        speaks.push({ lang: utterance.lang, text: utterance.text, voice: utterance.voice });
        if (utterance.onerror) utterance.onerror({ error: "language-unavailable" });
      },
    },
    SpeechSynthesisUtterance: function SpeechSynthesisUtterance(text) {
      this.text = text;
      this.lang = "";
      this.rate = 1;
      this.voice = null;
      this.onend = null;
      this.onerror = null;
    },
    Audio: function Audio() {
      this.preload = "";
      this.currentTime = 0;
      this.pause = () => {};
      this.play = () => Promise.reject(Object.assign(new Error("interrupted"), { name: "AbortError" }));
    },
  });

  const card = { hanzi: "你", pinyin: "nǐ", audio: "" };
  const results = await Promise.all([
    ctx.VocabAudio.play(card),
    ctx.VocabAudio.play(card),
    ctx.VocabAudio.play(card),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.deepEqual(results, [true, true, true]);
  assert.equal(speaks.length, 1);
  assert.equal(speaks[0].lang, "zh-CN");
  assert.equal(speaks[0].voice, null);

  speaks.length = 0;
  const fileCard = { hanzi: "你", pinyin: "nǐ", audio: "./audio/missing.mp3" };
  const fileResults = await Promise.all([
    ctx.VocabAudio.play(fileCard),
    ctx.VocabAudio.play(fileCard),
  ]);
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(fileResults.every((value) => value === true || value === false), true);
  assert.equal(speaks.length, 1);

  ctx.speechSynthesis.speak = () => {
    throw new Error("speech failed");
  };
  await assert.doesNotReject(() => ctx.VocabAudio.play(card));
  await new Promise((resolve) => setTimeout(resolve, 70));
});
