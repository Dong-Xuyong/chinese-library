# More Life Chinese

Mobile-first Chinese vocabulary library and in-browser Anki-style study deck, built from Obsidian notes.

**Phone URL:** https://dong-xuyong.github.io/chinese-library/

## What it is

- **Practice** — the landing page. A daily goal of 20 reviews, spaced-repetition ratings, and a streak, XP, and combo on this page only
- **Library** — searchable list of learning + known words (hanzi, pinyin, gloss, POS, keywords)
- **Progress** — learning journey curve + timeline, mastery, SRS due status, topic/POS mix, and audio coverage
- Data comes from `data/vocab.json` (and `data/journey.json` for historical curve), generated from your vault notes

## Rebuild vocabulary

From the repo root (defaults point at the Obsidian vault on this machine):

```bash
python build/parse_vocab.py
```

This rebuilds `data/vocab.json`, copies matching Obsidian `.mp3` embeds into `audio/{id}.mp3` (from `Journal/attachments` by default), and refreshes `data/journey.json` from vault git history.

Cards for 通用规范汉字表 level-1 characters that are not in the Obsidian notes live in `data/common-3500.json`. The rebuild appends them (status learning, deck `common-3500`) and does not overwrite an Obsidian entry with the same hanzi. See `data/SOURCES.md`.

Or with explicit paths:

```bash
python build/parse_vocab.py \
  --learning "C:/Users/Dong/Desktop/Obsidian/More Life/_040 Chinese Vocabulary.md" \
  --known "C:/Users/Dong/Desktop/Obsidian/More Life/_042 Chinese Known Words.md" \
  --audio-dir "C:/Users/Dong/Desktop/Obsidian/Journal/attachments" \
  --out data/vocab.json
```

Rebuild the journey series alone:

```bash
python build/build_journey.py
```

Commit and push `data/vocab.json`, `data/journey.json`, and `audio/` after rebuilding so GitHub Pages stays in sync.

Cards with a recorded file play that audio; cards without one use the browser's Chinese speech synthesis as a fallback.

## How to use

### Library

1. Open the site on your phone or desktop.
2. Search by hanzi, pinyin, gloss, or keywords.
3. Filter by **All / Learning / Known**, part of speech, and keyword chips.
4. Tap a word for the detail sheet (example, notes, keywords). Tap a keyword chip to filter the list.
5. Tap **Mark as known** (or **Mark as learning**) to move a word between decks — saved on this device.

### Practice

1. Open the site. Practice is the first screen (`#practice`; `#study` still opens it).
2. The ring shows today's reviews as `7/20`. **Start** deals the cards still in today's goal.
3. Today is done at 20 reviews, or when nothing is due. Tap the card (or **Reveal**), then rate **Again / Hard / Good / Easy**.
4. A correct run shows a combo. Finishing the 20 plays a short celebration. The streak counts Lisbon days the goal was hit.

### Progress

1. Open the **Progress** tab for the **Learning journey** curve and timeline, plus mastery, SRS, topics, POS, and audio charts.
2. Vault history powers the past curve; from today, mark-known and practice activity stay in this browser and sync with GitHub.
3. Tap a recently mastered chip or timeline word to open it in Library.
4. Tap a topic or POS bar to jump into a filtered Library view.
5. Tap **Practice due cards** to go straight to Practice.

Hash routes: `#practice` (`#study` too), `#library`, `#progress`, `#word/<id>`.

## Synced daily count

`chinese-library.json` in the private progress-sync repo. Practice and the hub use the same reviewedToday:

1. If `journey.events` is an array, sum `count` on entries with `type: "study"` whose `date` is today's `YYYY-MM-DD` in Europe/Lisbon. A missing or non-positive `count` contributes 1. Each rating adds 1 to that day's single event. The event shape stays `{ date, type: "study", label, count }`.
2. If `journey.events` is not an array, count `srs.<cardId>.last` values (Unix epoch milliseconds from the rating) whose Europe/Lisbon calendar day is today.

`remaining = min(due, max(0, 20 - reviewedToday))`. Due cards are learning words with no SRS row, or `srs[id].due <= now`.

Optional `game` (old files without it still load): `xp` (10 per rating), `streak`, `lastGoalDate`, `combo`, `comboAt`, `bestCombo`, `celebratedDate`. Level is `1 + floor(xp / 100)`. Merge keeps the higher XP and does not drop `status`, `srs`, or `journey`.

## Enable GitHub Pages

1. Push this repo to GitHub (`dong-xuyong/chinese-library`).
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` deploys on every push to `main`.

## Local preview

Serve the repo root over HTTP (fetch needs a server):

```bash
npx --yes serve .
```

Then open the printed URL (paths are relative so the same files work at `/chinese-library/` on Pages).
