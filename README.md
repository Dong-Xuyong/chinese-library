# More Life Chinese

Mobile-first Chinese vocabulary library and in-browser Anki-style study deck, built from Obsidian notes.

**Phone URL:** https://dong-xuyong.github.io/chinese-library/

## What it is

- **Library** — searchable list of learning + known words (hanzi, pinyin, gloss, POS, keywords)
- **Study** — spaced-repetition flashcards (Again / Hard / Good / Easy) with progress in `localStorage`
- **Progress** — learning journey curve + timeline, mastery, SRS due status, topic/POS mix, and audio coverage
- Data comes from `data/vocab.json` (and `data/journey.json` for historical curve), generated from your vault notes

## Rebuild vocabulary

From the repo root (defaults point at the Obsidian vault on this machine):

```bash
python build/parse_vocab.py
```

This rebuilds `data/vocab.json`, copies matching Obsidian `.mp3` embeds into `audio/{id}.mp3` (from `Journal/attachments` by default), and refreshes `data/journey.json` from vault git history.

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

### Study

1. Switch to the **Study** tab.
2. Optionally narrow by status and keyword.
3. Tap **Start study** for due cards.
4. Tap the card (or **Reveal**), then rate **Again / Hard / Good / Easy**.

### Progress

1. Open the **Progress** tab for the **Learning journey** curve and timeline, plus mastery, SRS, topics, POS, and audio charts.
2. Vault history powers the past curve; from today, mark-known and study activity stay in this browser (`localStorage`).
3. Tap a recently mastered chip or timeline word to open it in Library.
4. Tap a topic or POS bar to jump into a filtered Library view.
5. Tap **Study due cards** to go straight to Study.

Hash routes: `#library`, `#study`, `#progress`, `#word/<id>`.

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
